// 搜索服务单测：用例移植自桌面端 tests/StickyNotes.Tests/SearchServiceTests.cs 的关键场景
import {
  buildMultiKeywordsSegments,
  filterNotes,
  highlightSegments,
  isMatch,
  searchNotes,
} from '../src/services/search';
import type { Note } from '../src/data/note';

let seq = 0;
function makeNote(content: string, overrides: Partial<Note> = {}): Note {
  seq += 1;
  return {
    id: `note-${String(seq).padStart(3, '0')}`,
    content,
    color: 'yellow',
    isPinnedInList: false,
    alwaysOnTop: false,
    isDeleted: false,
    createdAt: '2026-10-01T00:00:00.0000000Z',
    updatedAt: '2026-10-01T00:00:00.0000000Z',
    ...overrides,
  };
}

describe('关键词解析与匹配门槛', () => {
  test('空关键词：filterNotes 原样返回，searchNotes 返回空', () => {
    const notes = [makeNote('hello'), makeNote('world')];
    expect(filterNotes(notes, '')).toEqual(notes);
    expect(filterNotes(notes, '   \t ')).toEqual(notes);
    expect(searchNotes(notes, '')).toEqual([]);
    expect(isMatch(notes[0], '  ')).toBe(true);
  });

  test('大小写不敏感子串匹配', () => {
    const note = makeNote('TODO list for Monday');
    expect(filterNotes([note], 'todo')).toContain(note);
    expect(filterNotes([note], 'MONDAY')).toContain(note);
    expect(filterNotes([note], 'sunday')).toEqual([]);
  });

  test('多词 AND：tokens 可分散在不同行（跨行组合匹配）', () => {
    const note = makeNote('buy milk\nmeeting at 3pm');
    expect(filterNotes([note], 'milk meeting')).toContain(note);
    expect(filterNotes([note], 'milk friday')).toEqual([]);
  });

  test('紧凑连写匹配：查询带空格而正文无空格（CJK 场景）', () => {
    const note = makeNote('今天下午会议周一开始');
    expect(isMatch(note, '会议 周一')).toBe(true);
    expect(isMatch(note, '会议 周二')).toBe(false);
  });

  test('完整短语（含空格）优先于分词：正文含连续短语即命中', () => {
    const note = makeNote('hello world again');
    expect(isMatch(note, 'hello world')).toBe(true);
  });

  test('已删除便签被排除', () => {
    const deleted = makeNote('needle in haystack', { isDeleted: true });
    const alive = makeNote('needle here');
    expect(filterNotes([deleted, alive], 'needle')).toEqual([alive]);
    expect(searchNotes([deleted, alive], 'needle').map((c) => c.note.id)).toEqual([alive.id]);
  });
});

describe('质量分级与卡片合成', () => {
  test('Tier 1（完整短语）便签排在 Tier 3（跨行组合）之前', () => {
    const phrase = makeNote('hello world', { updatedAt: '2026-10-01T00:00:00.0000000Z' });
    const scattered = makeNote('hello there\nworld peace', {
      updatedAt: '2026-10-02T00:00:00.0000000Z',
    });
    const cards = searchNotes([scattered, phrase], 'hello world');
    expect(cards[0].note.id).toBe(phrase.id);
    expect(cards[0].tier).toBe(1);
    expect(cards[1].note.id).toBe(scattered.id);
    expect(cards[1].tier).toBe(3);
  });

  test('Tier 2：全部 tokens 同行但不连续', () => {
    const note = makeNote('say hello brave world');
    const cards = searchNotes([note], 'hello world');
    expect(cards).toHaveLength(1);
    expect(cards[0].tier).toBe(2);
    expect(cards[0].lineNumber).toBe(1);
  });

  test('同便签多命中行、行距 ≤2 时合并为一张卡片', () => {
    const note = makeNote('hit one\nplain\nhit two');
    const cards = searchNotes([note], 'hit');
    expect(cards).toHaveLength(1);
    expect(cards[0].lineNumber).toBe(1);
    expect(cards[0].lastLineNumber).toBe(3);
  });

  test('行距 >2 的命中行拆为多张卡片，单便签上限 3 张且按质量/行号截断', () => {
    const lines = Array.from({ length: 16 }, (_, i) => (i % 3 === 0 ? 'needle here' : `line ${i}`));
    const note = makeNote(lines.join('\n'));
    const cards = searchNotes([note], 'needle');
    expect(cards).toHaveLength(3); // 6 组命中，截断为 3
    expect(cards[0].lineNumber).toBe(1);
    expect(cards[1].lineNumber).toBe(4);
    expect(cards[2].lineNumber).toBe(7);
  });

  test('上下文窗口为命中行各外扩一行，首行带前导省略号', () => {
    const note = makeNote(['a', 'b', 'c', 'd needle', 'e', 'f'].join('\n'));
    const cards = searchNotes([note], 'needle');
    expect(cards).toHaveLength(1);
    expect(cards[0].snippetLines).toHaveLength(3); // 行 2~4（1 基 3~5）
    expect(cards[0].snippetLines[0].segments[0].text).toBe('...c');
  });

  test('全局排序：同 Tier 按更新时间新→旧，置顶不参与搜索排序', () => {
    const older = makeNote('alpha target', { updatedAt: '2026-09-01T00:00:00.0000000Z' });
    const newer = makeNote('bravo target', { updatedAt: '2026-10-05T00:00:00.0000000Z', isPinnedInList: true });
    const cards = searchNotes([older, newer], 'target');
    expect(cards.map((c) => c.note.id)).toEqual([newer.id, older.id]);
  });

  test('词频：全文非重叠命中次数（区间合并）', () => {
    const note = makeNote('target and target again, another target');
    const cards = searchNotes([note], 'target');
    expect(cards[0].totalMatches).toBe(3);
    expect(cards[0].lineNumber).toBe(1);
    expect(cards[0].charIndex).toBe(0);
  });

  test('CJK 行号与绝对偏移计算', () => {
    const note = makeNote('第一行\n第二行命中文字\n第三行');
    const cards = searchNotes([note], '命中');
    expect(cards).toHaveLength(1);
    expect(cards[0].lineNumber).toBe(2);
    // 第一行 3 字符 + 换行 1 = 4；行内偏移 3 → 绝对偏移 7
    expect(cards[0].charIndex).toBe(7);
  });
});

describe('多关键词高亮', () => {
  test('buildMultiKeywordsSegments：区间合并且贪婪最长匹配', () => {
    // 相邻命中区间（首尾相接）合并为一个高亮段，对齐桌面端 next.Start <= cur.End 的合并语义
    expect(buildMultiKeywordsSegments('helloworld', ['hello', 'world'])).toEqual([
      { text: 'helloworld', hit: true },
    ]);
    // 长词优先：abcde 覆盖 abc
    expect(buildMultiKeywordsSegments('abcde', ['abc', 'abcde'])).toEqual([
      { text: 'abcde', hit: true },
    ]);
  });

  test('buildMultiKeywordsSegments：无命中与非重叠区间', () => {
    expect(buildMultiKeywordsSegments('plain text', ['zzz'])).toEqual([
      { text: 'plain text', hit: false },
    ]);
    expect(buildMultiKeywordsSegments('xfooYbarZ', ['foo', 'bar'])).toEqual([
      { text: 'x', hit: false },
      { text: 'foo', hit: true },
      { text: 'Y', hit: false },
      { text: 'bar', hit: true },
      { text: 'Z', hit: false },
    ]);
  });

  test('highlightSegments 兼容旧签名，空 query 返回整体不命中', () => {
    expect(highlightSegments('hello world', '')).toEqual([{ text: 'hello world', hit: false }]);
  });

  test('highlightSegments 多词 query：按 tokens 全集高亮', () => {
    const segments = highlightSegments('buy milk then meeting', 'milk meeting');
    expect(segments).toEqual([
      { text: 'buy ', hit: false },
      { text: 'milk', hit: true },
      { text: ' then ', hit: false },
      { text: 'meeting', hit: true },
    ]);
  });
});
