// 搜索服务：算法对齐桌面端 StickyNotesDesktop/Services/SearchService.cs
// 关键词解析（短语/分词/紧凑连写）→ 便签级匹配门槛 → 行级扫描与质量分级（Tier 1~3）
// → 相邻命中行合并为卡片（单便签上限 3 张）→ 全局按「最高质量 → 更新时间」排序；
// 高亮采用多关键词区间合并 + 贪婪最长匹配。纯内存实现，两端均无 FTS/SQL 搜索。
import type { Note } from '../data/note';

export interface SearchSegment {
  text: string;
  hit: boolean;
}

/** 摘要上下文行：整行的多关键词高亮分段 */
export interface SnippetLine {
  segments: SearchSegment[];
}

/** 匹配质量分级：1 完整短语 > 2 同行全词 > 3 部分词/跨行/兜底 */
export type SearchTier = 1 | 2 | 3;

/** 搜索命中卡片：一张便签可有 1~3 张（相邻命中行合并后计数） */
export interface SearchHitCard {
  note: Note;
  /** 首个命中行（1 基） */
  lineNumber: number;
  /** 末个命中行（1 基），合并卡片时大于 lineNumber */
  lastLineNumber: number;
  /** 命中起始绝对字符偏移（相对全文，供编辑器定位） */
  charIndex: number;
  /** 命中选区长度（首末命中词之间的跨度） */
  length: number;
  /** 1~3 行上下文摘要（含前导 "..."），已做多关键词高亮分段 */
  snippetLines: SnippetLine[];
  /** 该便签全文非重叠命中总次数 */
  totalMatches: number;
  tier: SearchTier;
}

/** 相邻命中行行距不超过该值时链式合并为一张卡片 */
const MERGE_LINE_GAP = 2;
/** 单便签最多产出的命中卡片数，避免长文本便签刷屏 */
const MAX_CARDS_PER_NOTE = 3;
/** 摘要单行最大长度，超长围绕关键词智能截取 */
const MAX_SNIPPET_LINE_LENGTH = 85;

interface ParsedKeyword {
  /** 去首尾空白的完整短语（保留内部空格原样） */
  trimmed: string;
  /** 按空格/制表符拆分的词，AND 语义 */
  tokens: string[];
  /** tokens 无缝连写（"会议 周一" → "会议周一"，容错 CJK 手动空格） */
  compact: string;
}

/** 解析搜索关键词；无有效 token（空/全空白）返回 null（语义：不过滤） */
function parseKeyword(query: string): ParsedKeyword | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const tokens = trimmed.split(/[\t ]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return { trimmed, tokens, compact: tokens.join('') };
}

/** 收集待匹配与待高亮的关键词集合（去重，按长度降序，优先长匹配） */
function collectKeywords(parsed: ParsedKeyword): string[] {
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const k of [parsed.compact, parsed.trimmed, ...parsed.tokens]) {
    if (!k) continue;
    const lower = k.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      keywords.push(k);
    }
  }
  return keywords.sort((a, b) => b.length - a.length);
}

// 注：忽略大小写匹配统一在预先生成的小写文本上做 indexOf，
// JS 的 toLowerCase 极端 Unicode 下可能改变长度导致偏移错位，
// 与桌面端 OrdinalIgnoreCase 一样属可接受边界，不在此处理。
function ciIncludes(lowerHaystack: string, needle: string): boolean {
  return lowerHaystack.includes(needle.toLowerCase());
}

function ciIndexOf(lowerHaystack: string, needle: string): number {
  return lowerHaystack.indexOf(needle.toLowerCase());
}

/** 便签正文级匹配门槛：A 完整短语 / B 紧凑连写 / C 全部 tokens（AND，位置可分散），三条件 OR */
function matchesContent(contentLower: string, parsed: ParsedKeyword): boolean {
  return (
    ciIncludes(contentLower, parsed.trimmed) ||
    (parsed.compact.length > 0 && ciIncludes(contentLower, parsed.compact)) ||
    parsed.tokens.every((t) => ciIncludes(contentLower, t))
  );
}

/** 便签匹配布尔判定，供归档页等筛选场景复用；空白关键词恒返回 true（不过滤） */
export function isMatch(note: Note, query: string): boolean {
  const parsed = parseKeyword(query);
  if (!parsed) return true;
  const content = note.content ?? '';
  // 标题由内容首行派生、必为内容子串，无需单独匹配（对齐桌面端 IsMatch 的结论）
  return matchesContent(content.toLowerCase(), parsed);
}

/** 列表过滤（保持入参顺序），多词 AND 语义；排除已删除便签 */
export function filterNotes(notes: Note[], query: string): Note[] {
  const parsed = parseKeyword(query);
  if (!parsed) return notes;
  return notes.filter((n) => !n.isDeleted && matchesContent((n.content ?? '').toLowerCase(), parsed));
}

/**
 * 对单行做匹配质量分级并给出命中选区（行内相对 [Start, End)）：
 * Tier 1 行内包含完整短语 trimmed 或紧凑连写 compact（取行内最早出现者）；
 * Tier 2 短语不连续但全部 tokens 同行（选区首 token 起点至末 token 终点）；
 * Tier 3 仅部分 tokens 命中（跨行组合，取最早出现者）。
 * lineLower 为该行的小写文本（与原文索引对齐的前提下复用扫描结果）。
 */
function classifyLine(
  lineLower: string,
  parsed: ParsedKeyword,
): { tier: SearchTier; relStart: number; relEnd: number } | null {
  const { trimmed, tokens, compact } = parsed;
  let minStart = Number.MAX_SAFE_INTEGER;
  let minStartLen = 0;
  let maxEnd = -1;
  let hitCount = 0;
  for (const t of tokens) {
    const pos = ciIndexOf(lineLower, t);
    if (pos < 0) continue;
    hitCount++;
    if (pos < minStart) {
      minStart = pos;
      minStartLen = t.length;
    }
    if (pos + t.length > maxEnd) maxEnd = pos + t.length;
  }
  if (hitCount === 0) return null;

  if (hitCount === tokens.length) {
    const singleToken = compact === trimmed;
    const phrasePos = singleToken ? minStart : ciIndexOf(lineLower, trimmed);
    const compactPos = singleToken ? phrasePos : ciIndexOf(lineLower, compact);
    if (phrasePos >= 0 || compactPos >= 0) {
      // Tier 1：完整短语 / 连写词，取行内最早出现者
      if (phrasePos < 0 || (compactPos >= 0 && compactPos < phrasePos)) {
        return { tier: 1, relStart: compactPos, relEnd: compactPos + compact.length };
      }
      return { tier: 1, relStart: phrasePos, relEnd: phrasePos + trimmed.length };
    }
    // Tier 2：全部 tokens 同行（不连续）
    return { tier: 2, relStart: minStart, relEnd: maxEnd };
  }
  // Tier 3：部分 tokens（跨行组合匹配）
  return { tier: 3, relStart: minStart, relEnd: minStart + minStartLen };
}

/** 统计关键词在全文中的非重叠总出现次数（区间合并，O(关键词数×全文)） */
function countTotalMatches(contentLower: string, keywords: string[]): number {
  const intervals: [number, number][] = [];
  for (const kw of keywords) {
    let idx = 0;
    while (idx < contentLower.length) {
      const pos = contentLower.indexOf(kw.toLowerCase(), idx);
      if (pos < 0) break;
      intervals.push([pos, pos + kw.length]);
      idx = pos + Math.max(1, kw.length);
    }
  }
  if (intervals.length === 0) return 0;

  intervals.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : b[1] - a[1]));
  let count = 0;
  let curEnd = -1;
  for (const [start, end] of intervals) {
    if (start >= curEnd) {
      count++;
      curEnd = end;
    }
  }
  return count;
}

/**
 * 多关键词高亮分段：逐词收集命中区间 → 按起点升序/终点降序排序并合并重叠
 * → 切分文本。同起点贪婪取最长命中（keywords 需按长度降序，本函数内部兜底排序）。
 */
export function buildMultiKeywordsSegments(snippet: string, keywords: string[]): SearchSegment[] {
  const segments: SearchSegment[] = [];
  if (!snippet) return segments;

  const validKeywords = keywords.filter((k) => k && k.trim().length > 0);
  if (validKeywords.length === 0) {
    segments.push({ text: snippet, hit: false });
    return segments;
  }

  const lower = snippet.toLowerCase();
  const intervals: [number, number][] = [];
  for (const kw of validKeywords) {
    let searchIdx = 0;
    while (searchIdx < snippet.length) {
      const pos = lower.indexOf(kw.toLowerCase(), searchIdx);
      if (pos < 0) break;
      intervals.push([pos, pos + kw.length]);
      searchIdx = pos + Math.max(1, kw.length);
    }
  }
  if (intervals.length === 0) {
    segments.push({ text: snippet, hit: false });
    return segments;
  }

  intervals.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : b[1] - a[1]));
  const merged: [number, number][] = [];
  let cur = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i];
    if (next[0] <= cur[1]) {
      if (next[1] > cur[1]) cur = [cur[0], next[1]];
    } else {
      merged.push(cur);
      cur = next;
    }
  }
  merged.push(cur);

  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: snippet.slice(cursor, start), hit: false });
    segments.push({ text: snippet.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < snippet.length) segments.push({ text: snippet.slice(cursor), hit: false });
  return segments;
}

/**
 * 命中片段拆分（用于 Text 嵌套渲染高亮），兼容旧单关键词调用方签名；
 * query 含空格时按短语/连写/tokens 全集做多关键词高亮。
 */
export function highlightSegments(text: string, query: string): SearchSegment[] {
  const parsed = parseKeyword(query);
  if (!parsed) return [{ text, hit: false }];
  return buildMultiKeywordsSegments(text, collectKeywords(parsed));
}

/** 超长单行围绕最早命中关键词智能截取，保证卡片显示精简（对齐桌面端 TruncateLineSafely） */
function truncateLineSafely(line: string, keywords: string[]): string {
  if (line.length <= MAX_SNIPPET_LINE_LENGTH) return line;
  const lower = line.toLowerCase();
  let earliest = -1;
  let kwLen = 0;
  for (const kw of keywords) {
    const pos = ciIndexOf(lower, kw);
    if (pos >= 0 && (earliest < 0 || pos < earliest)) {
      earliest = pos;
      kwLen = kw.length;
    }
  }
  if (earliest >= 0) {
    const subStart = Math.max(0, earliest - 30);
    const subLen = Math.min(line.length - subStart, kwLen + 60);
    let snippet = line.slice(subStart, subStart + subLen);
    if (subStart > 0 && !snippet.startsWith('...')) snippet = '...' + snippet;
    if (subStart + subLen < line.length && !snippet.endsWith('...')) snippet += '...';
    return snippet;
  }
  // 无命中的上下文行截取前 75 字符
  return line.slice(0, 75) + '...';
}

/** 提取 [startLine, endLine] 上下文行（首行上方有内容时加前导省略号）并做多关键词高亮分段 */
function buildContextWindow(
  lines: string[],
  startLine: number,
  endLine: number,
  keywords: string[],
): SnippetLine[] {
  const snippetLines: SnippetLine[] = [];
  for (let lineIdx = startLine; lineIdx <= endLine; lineIdx++) {
    let text = lines[lineIdx];
    if (lineIdx === startLine && startLine > 0 && !text.startsWith('...')) {
      text = '...' + text;
    }
    text = truncateLineSafely(text, keywords);
    snippetLines.push({ segments: buildMultiKeywordsSegments(text, keywords) });
  }
  return snippetLines;
}

interface HitLine {
  lineIndex: number;
  tier: SearchTier;
  absStart: number;
  absEnd: number;
}

function buildHitCard(
  note: Note,
  lines: string[],
  keywords: string[],
  hitLines: HitLine[],
  from: number,
  to: number,
  totalMatches: number,
): SearchHitCard {
  const firstLine = hitLines[from].lineIndex;
  const lastLine = hitLines[to].lineIndex;
  let tier: SearchTier = hitLines[from].tier;
  for (let i = from + 1; i <= to; i++) {
    if (hitLines[i].tier < tier) tier = hitLines[i].tier;
  }
  // 行号升序扫描保证 AbsStart 严格递增，组内首命中词即首行的 AbsStart
  const absStart = hitLines[from].absStart;
  let absEnd = hitLines[from].absEnd;
  for (let i = from + 1; i <= to; i++) {
    if (hitLines[i].absEnd > absEnd) absEnd = hitLines[i].absEnd;
  }

  const startLine = Math.max(0, firstLine - 1);
  const endLine = Math.min(lines.length - 1, lastLine + 1);
  const snippetLines = buildContextWindow(lines, startLine, endLine, keywords);

  return {
    note,
    lineNumber: firstLine + 1,
    lastLineNumber: lastLine + 1,
    charIndex: absStart,
    length: absEnd - absStart,
    snippetLines,
    totalMatches,
    tier,
  };
}

/**
 * 全量搜索：返回卡片化结果（每便签最多 3 张，全局「便签最高 Tier 升序 → updatedAt 降序」，
 * 同便签卡片相邻，组内 Tier → 行号）。搜索排序不考虑置顶。
 * 范围仅未删除便签；搜索词为空返回空数组。
 */
export function searchNotes(notes: Note[], query: string): SearchHitCard[] {
  const parsed = parseKeyword(query);
  if (!parsed) return [];
  const keywords = collectKeywords(parsed);

  const noteResults: { cards: SearchHitCard[]; bestTier: SearchTier; updatedAt: string }[] = [];
  for (const note of notes) {
    if (note.isDeleted) continue;
    const content = note.content;
    if (!content) continue;
    const contentLower = content.toLowerCase();

    // 1. 便签级匹配门槛（规则与 isMatch 的内容分支一致）
    if (!matchesContent(contentLower, parsed)) continue;

    // 2. 切分物理行并计算行偏移（\r 只 TrimEnd 不计偏移，与桌面端一致）
    const rawLines = content.split('\n');
    const lines: string[] = [];
    const lineStartOffsets: number[] = [];
    let runningOffset = 0;
    for (const raw of rawLines) {
      lineStartOffsets.push(runningOffset);
      lines.push(raw.replace(/\r+$/, ''));
      runningOffset += raw.length + 1;
    }

    // 全文词频对同一便签的所有卡片是同一个值，只在便签级计算一次
    const totalMatches = Math.max(1, countTotalMatches(contentLower, keywords));

    // 3. 全行扫描：收集每个命中行的分级与选区（不找到首行即停）
    const hitLines: HitLine[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cls = classifyLine(line.toLowerCase(), parsed);
      if (cls) {
        hitLines.push({
          lineIndex: i,
          tier: cls.tier,
          absStart: lineStartOffsets[i] + cls.relStart,
          absEnd: lineStartOffsets[i] + cls.relEnd,
        });
      }
    }

    // 4. 相邻命中行就近合并（行距 ≤ MERGE_LINE_GAP 链式并入同组），每组一张卡片
    const cards: SearchHitCard[] = [];
    if (hitLines.length > 0) {
      let groupStart = 0;
      for (let i = 1; i <= hitLines.length; i++) {
        const flush =
          i === hitLines.length || hitLines[i].lineIndex - hitLines[i - 1].lineIndex > MERGE_LINE_GAP;
        if (!flush) continue;
        cards.push(buildHitCard(note, lines, keywords, hitLines, groupStart, i - 1, totalMatches));
        groupStart = i;
      }
      // 便签内卡片排序：质量优先，同质量按行号；截断保留的永远是质量最高的命中项
      cards.sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.lineNumber - b.lineNumber));
      if (cards.length > MAX_CARDS_PER_NOTE) cards.length = MAX_CARDS_PER_NOTE;
    } else {
      // 兜底保护：行级扫描为空（关键词本身跨换行等极端输入）时，
      // 取全文首个命中生成一张最低质量卡片，防空结果
      const fallbackLength = Math.min(parsed.trimmed.length, content.length);
      cards.push({
        note,
        lineNumber: 1,
        lastLineNumber: 1,
        charIndex: 0,
        length: fallbackLength,
        snippetLines: buildContextWindow(lines, 0, Math.min(lines.length - 1, 2), keywords),
        totalMatches,
        tier: 3,
      });
    }

    const bestTier = cards.reduce<SearchTier>((min, c) => (c.tier < min ? c.tier : min), 3);
    noteResults.push({ cards, bestTier, updatedAt: note.updatedAt });
  }

  // 5. 全局分组排序：便签最高质量优先，同质量按更新时间新→旧
  noteResults.sort(
    (a, b) => a.bestTier - b.bestTier || b.updatedAt.localeCompare(a.updatedAt),
  );
  const results: SearchHitCard[] = [];
  for (const group of noteResults) results.push(...group.cards);
  return results;
}
