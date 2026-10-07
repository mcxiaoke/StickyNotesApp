# 移动端搜索对齐桌面端 — 实现方案

> 日期：2026-10-06
> 参考：桌面端 `StickyNotesDesktop/src/StickyNotes/Services/SearchService.cs`、`ViewModels/NotesListViewModel.cs`、`Views/NotesListWindow.xaml(.cs)`

## 1. 背景与现状

移动端当前搜索总共约 40 行代码，核心是 `src/src/services/search.ts:9-13`：

```ts
export function filterNotes(notes: Note[], query: string): Note[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) => n.content.toLowerCase().includes(q));
}
```

即：把整个输入（含空格）当作一个连续子串，对 `content` 做内存 `includes` 匹配。输入带空格或多词时几乎必失败，无分级、无上下文、无计数、无防抖、归档页无搜索。

桌面端（WPF）的搜索是纯内存行级扫描 + 质量分级 + 卡片化结果，20 个单元测试覆盖，是两端中更完整的一套。**两端均无 SQL/FTS 全文索引、无拼音、无标签、无搜索历史**，因此对齐以桌面端算法与交互为基准，在 RN 上等价移植，不引入新依赖。

### 能力对比矩阵

| 能力 | 桌面端 | 移动端现状 | 本方案 |
|---|---|---|---|
| 多关键词（空格 AND） | ✅ | ❌ 整体子串 | P0 |
| 紧凑连写匹配（CJK 空格容错） | ✅ | ❌ | P0 |
| 匹配质量分级 Tier 1~3 + 相关度排序 | ✅ | ❌ | P0 |
| 多关键词高亮（区间合并、贪婪最长匹配） | ✅ | ❌ 仅单子串 | P0 |
| 命中上下文（1~3 行）+ 行号徽标 | ✅ | ❌ 仅前 4 行预览 | P1 |
| 搜索态结果页（卡片化多命中） | ✅ | ❌ 复用普通列表 | P1 |
| 结果计数文案 | ✅ | ❌ | P1 |
| 输入防抖 | ✅ 80ms | ❌ | P0 |
| 清除按钮 / 放大镜图标 | ✅ | ❌ | P0 |
| 归档页搜索 | ✅ | ❌ | P1 |
| 点击结果定位到正文位置 | ✅ 字符级选区+滚动居中 | ❌ | P2（RN 受限，见 §6） |
| 搜索历史 / 拼音 / 标签过滤 / FTS | ❌ 均无 | ❌ | 不做（对齐原则：桌面端没有的不加） |

## 2. 设计原则

1. **算法逐条对齐桌面端**，包括边界行为（空关键词、单 token 退化、跨行兜底），桌面端 `tests/StickyNotes.Tests/SearchServiceTests.cs` 的用例尽量转化为 TS 单测。
2. **纯内存方案不变**。两端都是全量加载后内存扫描；移动端数据量（个人便签）远小于桌面端，不必上 FTS。
3. **RN 平台适配**：桌面端的 `Task.Run` 后台线程 + Dispatcher 回 UI，在 RN 中改为「防抖 + `useMemo` 同步计算」（JS 单线程，数据量小同步足够；防抖保证每 300ms 最多算一次）。
4. 分层不变：`services/search.ts` 承载全部算法（保持纯函数、可单测），UI 只做消费。

## 3. 核心算法设计（P0，重写 `src/src/services/search.ts`）

### 3.1 关键词解析（对齐 `ParseKeyword`，SearchService.cs:197-206）

```ts
interface ParsedKeyword { trimmed: string; tokens: string[]; compact: string }
function parseKeyword(query: string): ParsedKeyword | null {
  // trim → 按 ' ' 和 '\t' 拆 tokens（去空项）→ compact = tokens 无缝连写
  // tokens 为空返回 null（语义：不过滤）
}
```

### 3.2 便签级匹配门槛（对齐 `MatchesContent`，SearchService.cs:213-218）

对 `note.content` 做三条件 OR（忽略大小写）：
- A：包含完整短语 `trimmed`（保留空格原样）
- B：包含紧凑连写 `compact`（"会议 周一" → "会议周一"，容错 CJK 场景手动空格）
- C：全部 `tokens` 分别出现（AND，位置可分散）

### 3.3 结果结构：命中卡片（对齐 `SearchHit` / `Models/SearchHit.cs`）

搜索不再返回 `Note[]`，而是返回卡片列表：

```ts
interface SearchHitCard {
  note: Note;
  lineNumber: number;        // 首个命中行（1 基）
  lineRange?: string;        // "第 X 行" / "第 X-Y 行" 合并时的显示文案
  charIndex: number;         // 命中起始绝对偏移（供 P2 编辑器定位）
  length: number;
  snippetLines: SnippetLine[];  // 1~3 行上下文，含前导 "..."
  segments: SnippetSegment[];   // 多关键词高亮分段（整卡片正文）
  totalMatches: number;         // 该便签全文非重叠命中总数
  tier: 1 | 2 | 3;
}
```

### 3.4 行级扫描与分级（对齐 `Search` 主流程 + `ClassifyLine`，SearchService.cs:28-162、229-301）

1. 便签级门槛过滤（§3.2）。
2. 按 `\n` 切行并记录每行绝对偏移（`\r` 只 TrimEnd 不计偏移，与桌面端一致）。
3. 逐行扫描收集命中行：Tier 1 = 行内含 `trimmed` 或 `compact`（取行内最早者）；Tier 2 = 全部 tokens 同行但不连续（选区首 token 起点到末 token 终点）；Tier 3 = 部分 tokens（跨行组合）。
4. 相邻命中行行距 ≤ 2 链式合并为一张卡片；单便签最多 3 张卡片，按 Tier → 行号排序后截断。
5. 行级扫描为空时兜底：取全文首个命中生成一张 Tier 3 卡片（防关键词本身跨行导致空结果）。
6. 全文词频 `countTotalMatches` 用区间合并算法（对齐 SearchService.cs:453-483，O(关键词数×全文)）。

### 3.5 排序（对齐 SearchService.cs:148）

便签最高 Tier 升序 → `updatedAt` 降序；同便签卡片相邻；置顶不参与搜索排序。

### 3.6 多关键词高亮（移植 `BuildMultiKeywordsSegments`，SearchService.cs:488-563）

待高亮词集合 = `{trimmed, compact, ...tokens}` 按长度降序；逐词收集命中区间 → 排序合并重叠区间 → 切分为 `SnippetSegment[]`。替换现有单子串 `highlightSegments`（保留旧函数名做兼容包装或直接删除旧实现，由调用方统一走新函数）。

## 4. UI 与交互设计

### 4.1 搜索框升级（`src/src/app/index.tsx:131-141`）

- 左侧放大镜图标（Ionicons `search-outline`）、右侧清除按钮（`close-circle`，`query` 非空时显示，点击清空并收起键盘）。
- `keyboardType="default"`、`autoCorrect={false}`、`autoCapitalize="none"`、`clearButtonMode` 语义用自绘按钮（Android 无原生 clearButtonMode）。
- 保持占位文案「搜索便签内容...」。

### 4.2 防抖与搜索态

- 输入经 300ms 防抖后写入实际参与计算的 `searchQuery` state（桌面端 80ms 是桌面键盘节奏，移动端参照设计文档 §4.2 的 300ms 承诺）。
- `query` 非空即进入「搜索态」：隐藏分类 Chips 与普通瀑布流，显示搜索结果列表（对齐桌面端 `IsSearching` 切换，NotesListWindow.xaml:386 起）。
- 搜索范围仅未删除便签（与桌面端一致；归档页单独搜归档）。

### 4.3 结果列表（对齐桌面端 SearchHitsListBox）

- FlatList/FlashList 单列渲染 `SearchHitCard`：便签标题（首行派生，沿用 `displayTitle` 逻辑）、1~3 行上下文（`segments` 高亮，命中段样式沿用 `NoteCard.tsx:31` 的 accent 配色）、行号徽标（`第 X 行` / `第 X-Y 行` / `第 X 行 · 共 N 处`）、更新时间。
- 同便签卡片紧凑排列（分组间距大、卡片间小），数据本身已按排序保证相邻。
- 计数文案（对齐桌面端 `SearchStatusText`）：`找到 N 条结果（来自 M 张便签）`；无结果显示空态「没有匹配的便签」。
- 点击卡片 → 进入编辑页（携带 `charIndex`/`length` 参数，见 §6 P2）。

### 4.4 归档页搜索（`src/src/app/archive.tsx`）

- 归档列表顶部加同样的搜索框（放大镜 + 清除 + 防抖），复用 `filterNotes`/`isMatch`（导出轻量布尔判定 `isMatch(note, query)`，对齐桌面端 `SearchService.IsMatch`，避免归档页手写第二套规则）。

## 5. 文件改动清单

| 文件 | 改动 |
|---|---|
| `src/src/services/search.ts` | 重写：解析、门槛、行级分级、卡片合成、词频、多关键词高亮；新增导出 `searchNotes`、`isMatch` |
| `src/src/app/index.tsx` | 搜索框 UI、防抖、搜索态切换、结果列表、计数文案、空态 |
| `src/src/components/NoteCard.tsx` | 高亮调用改走多关键词 `highlightSegments`（签名不变则最小改动） |
| `src/src/app/archive.tsx` | 增加搜索框 + 过滤 |
| `src/src/app/note/[id].tsx` | P2：接收定位参数，选中并滚动到命中位置 |
| 新增 `src/src/services/__tests__/search.test.ts` | 单元测试（见 §7） |
| 新增 `src/src/components/SearchHitCard.tsx` | 命中卡片组件 |

## 6. 分期实施

- **P0（算法核心，1 次提交）**：重写 `search.ts`（§3 全部）+ 搜索框图标/清除按钮 + 防抖 + `index.tsx` 接入多词过滤（此阶段结果仍走现有列表渲染，行为立即改善）。
- **P1（结果体验）**：搜索态结果页 + `SearchHitCard`（上下文行/行号/词频/计数）+ 归档页搜索。
- **P2（编辑器定位，可选）**：编辑页接收 `charIndex`/`length`，用 `TextInput` 的 `selection` + `onContentSizeChange`/measure 实现滚动定位。RN 无桌面端 `TextBox.Select()` 的等价精确视口计算，做到「选中 + 滚动可见」即可，不追求严格居中；若测量成本过高可降级为「打开便签」。
- **不做**：FTS/SQL 搜索、拼音、标签、搜索历史、全局热键（桌面端均无或平台不适用）。

## 7. 测试计划

项目当前无 JS 测试框架，本方案引入 `vitest`（零配置、与 TS/ESM 兼容好）作为 devDependency，仅覆盖 `search.ts` 纯函数：

从桌面端 `SearchServiceTests.cs` 移植关键用例：空关键词、大小写不敏感、多词 AND 分散命中、紧凑连写匹配、Tier 分级与排序、相邻行合并、单便签 3 卡片截断、跨行兜底、词频非重叠计数、长行截断、高亮区间合并（重叠/嵌套）、CJK 文本行号计算、防抖不抛异常（RN 侧以纯函数为主，防抖逻辑放 UI 层不单测）。

验收标准：`npx vitest run` 全绿；手测「多词分散命中可搜出、结果含上下文与行号、清除按钮归位、归档页可搜」。

## 8. 风险与对策

1. **RN JS 线程阻塞**：纯内存扫描在几千条便签内为毫秒级；防抖兜底。若未来数据量增长，可迁移 `react-native-multithreading`/worklet，暂不需要。
2. **高亮性能**：每卡片高亮分段是 O(关键词数×行文本)，单卡片行数 ≤3，无风险；避免对全文一次性分段（只对 snippet 行做，与桌面端一致）。
3. **行为回归**：非搜索态列表（置顶优先 + updatedAt 排序、Chips 过滤）保持不动；搜索态的排序变化不影响普通浏览。
4. **`highlightSegments` 消费方兼容**：`NoteCard.tsx:24-29` 是唯一调用方，签名保持 `(text, query)` 不变，内部替换为多关键词算法（query 含空格时按 tokens 高亮）。
