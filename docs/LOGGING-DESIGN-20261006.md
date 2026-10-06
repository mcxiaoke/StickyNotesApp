# 日志系统改进方案（设计稿，2026-10-06）

> 状态：方案已评审确认（第四节为最终决策），待实施。
> 背景：设置页"复制日志"不可视、不可导出；WebDAV 添加时测试返回 413 无法知道请求了什么、返回了什么、有无异常。本文档先梳理现状与痛点，再给出改进方案。

## 一、现状梳理

### 1.1 现有日志能力

- `src/src/services/logger.ts`：
  - 内存环形缓冲，`MAX_ENTRIES = 300`，超限 shift 丢弃；
  - 级别仅 `info / warn / error`；
  - 每条记录 `time / level / tag / message / seq`，message 超长截断到 2000 字符；
  - 写入时同步镜像到 console（Metro / adb logcat 可观察）；
  - `getLines()` 导出文本（新在前），`count()`、`clear()`；
  - **无订阅机制**——UI 无法感知新日志，只能轮询 count；
  - **无持久化**——进程重启缓冲即空（唯一例外：崩溃报告本体存 kv，见下）。
- `src/src/services/crash.ts`：全局未捕获异常 + unhandledRejection 已接入 logger，崩溃报告持久化到 kv（`app.lastCrash.v1`），设置页可复制。这部分设计良好，保留不动。
- 已接入日志的位置：同步轮次（`syncRunner` / `scheduler` / `syncStore`）、自动保存失败（`autoSave`）、每日备份（`dbBackup` / `_layout`）、凭据读取（`credential`）、PIN 与生物识别（`pin`）、设置/同步设置损坏回落（`settingsStore` / `sync/settings`）、便签库防抖同步失败（`notesStore`）。整体覆盖不算差，短板集中在网络层与若干静默 catch。
- UI 入口：`src/src/app/settings/index.tsx` "诊断日志"卡片，仅「复制日志（N 条）」+「清空日志」两个按钮 + 上次崩溃报告块。

### 1.2 痛点定位

#### 核心痛点：网络层零日志（以 413 为例）

- `src/src/sync/backends/webdav.ts`
  - `request()`（L96-122）：fetch 成功拿到响应后直接 return，**不记录 method / URL / status / 响应体**；fetch 抛异常（超时 abort、DNS 失败、TLS 错误）也直接上抛，不落日志。
  - `throwForStatus()`（L210-218）：只抛 `HTTP 413` 状态码，**服务器返回的错误响应体被丢弃**——413 这类错误的 body 往往带具体原因（如坚果云流量配额说明），丢了就只能瞎猜。
  - 超时用 `AbortController.abort()` 抛 AbortError，与真实网络失败无法区分；无耗时记录。
- `src/src/sync/backends/s3.ts`：`signedFetch()`（L124-158）同样问题。
- `src/src/app/settings/sync.tsx` `handleTest()`（L122-152）：测试连接失败只把 message 塞进 `testResult` 文本，不进日志，应用重启后彻底无迹可寻。

#### 其它吞错误的位置（全项目 catch 共 41 处，逐一核对，需补点如下）

| 位置 | 问题 |
|---|---|
| `src/src/sync/engine.ts:140` | 单文件下载失败仅计数 + 记住第一个异常，**失败的是哪个 key、什么原因完全丢失**（只有全部失败才抛） |
| `src/src/sync/engine.ts:131` | 解密失败计入 `skippedInvalid`，无日志，不知道是哪个 key |
| `src/src/sync/backends/webdav.ts:143` | PROPFIND XML 解析失败丢弃原始异常与响应片段，只抛"不是合法 XML" |
| `src/src/sync/authVerifier.ts:29` | 探针校验失败静默返回 false |
| `src/src/sync/dto.ts:105` | `parseDto` 失败返回 null，坏文件是哪个 key 无从知晓 |
| `src/src/sync/crypto/vaultSecret.ts:20`、`cryptoHelper.ts:51,63` | 原生模块/本地密钥**静默回落**，用户可能在不知情下用了公开回落口令 |
| `src/src/app/settings/index.tsx:90,110` | 导出/导入失败只 Alert 不进日志，重启即丢 |

## 二、改进方案

### 2.1 logger 增强（`src/src/services/logger.ts`）

保持现有 `info/warn/error(tag, message)` API 兼容，新增：

1. **`debug` 级别**：进缓冲但**不镜像 console**（避免逐请求日志刷屏 logcat）；`getLines()` 默认包含 debug，导出时可过滤。
2. **订阅机制**：`subscribe(cb: () => void): () => void`（返回取消函数），push 时通知所有订阅者。UI 侧用 `useSyncExternalStore` 实时刷新。
3. **`getEntries()`**：返回 `LogEntry[]` 只读快照，供日志页渲染（级别着色、过滤）。
4. **缓冲上限 300 → 500**：每条很小，500 条约几十 KB 内存，可接受。
5. **warn/error 落盘持久化**（已定：路径用 document，1MB 截断重写）：
   - 新增 `services/logPersist.ts`（独立文件，不并入 logger）：
     - 写入路径：`Paths.document/logs/stickynotes-logs.log`（document 可靠，不会被系统清理）；
     - 仅追加 `warn` 与 `error` 级别条目，格式与 `getLines()` 一致；
     - 大小上限：超过 **1MB** 时**截断重写**（保留最近的日志，不保留 `.old`）；
     - 写失败静默（logger 内部不能再抛），最多镜像 console；
     - 读文件用现有 `expo-file-system` 的 `File` API（`backup.ts` 同款用法，零新增依赖）。
   - **导出必须包含落盘历史**：典型场景是进程崩溃或被杀后重启，内存缓冲为空，之前的 warn/error 只在落盘文件里。导出 txt = 持久化文件（warn/error 历史）+ 内存缓冲全量，按时间戳合并排序，不靠"先清内存再导"之类的侥幸。
6. **错误描述工具**：把 `crash.ts` 的 `formatError` 精神抽一个轻量 `describeError(ex)`（name + message + 前 N 行 stack + cause 链），供各 catch 点复用，避免全项目重复 `ex instanceof Error ? ex.message : String(ex)` 丢 stack。

### 2.2 日志查看界面

**新路由 `src/src/app/settings/logs.tsx`**，`src/src/app/_layout.tsx` 注册 `settings/logs`（title「日志」，headerBackTitle 返回）：

- **列表**：FlashList / FlatList 渲染，旧在前、新到自动滚底（提供"回到底部"小按钮可选）；级别着色：error 红、warn 黄、info 常规、debug 弱化灰。
- **实时更新**：`useSyncExternalStore(logger.subscribe, logger.getEntries)`，界面在栈顶时新日志即时出现。
- **级别过滤 chips**：全部 / Info / Warn / Error（debug 并入 Info 或单独，实现时定），默认"全部"。
- **顶部操作栏**：
  - **复制全部**：`Clipboard.setStringAsync`（现有 `copyLogs` 逻辑迁入）；
  - **导出（系统分享）**：写 `Paths.cache/stickynotes-logs-<时间戳>.txt` → `Sharing.shareAsync(uri, { mimeType: 'text/plain', dialogTitle: '导出日志' })` → 分享完成删临时文件。模式与 `services/backup.ts` `exportNotesAsync` 完全一致，零新增依赖（expo-sharing 已在 package.json）；
  - **清空**：清内存缓冲 + 询问是否同时清持久化文件（Alert 确认）。
- **隐私提示**：页脚保留一句"日志不含便签正文与凭据"。

**设置页改造**（`settings/index.tsx` L280-327）：

- 「复制日志（N 条）」按钮 → 「查看日志」入口（`router.push('/settings/logs')`）；
- 卡片保留：说明文字、上次崩溃报告块（复制/清除）、「清空日志」按钮移入日志页（设置页去掉）。

### 2.3 网络请求日志点（核心）

约定统一格式，tag 用 `webdav` / `s3`，级别 `debug`（成功与 4xx/5xx）与 `warn`（网络异常）：

- `webdav.ts request()`、`s3.ts signedFetch()` 内：
  - **拿到响应即记一行**：`PUT /stickynotes-data/notes/xx.json -> 413 (312ms) body=Server: quota exceeded...`
    - method + 相对路径（或完整 URL，URL 不含凭据）；
    - HTTP 状态码 + 耗时（startedAt 记录）；
    - **错误响应体截前 300 字符**（2xx 不读 body，避免额外内存）；413 定位的关键就是这段；
    - 2xx 也记（`-> 207 (95ms)`），量小（一轮同步 = 1 次 PROPFIND + N 个 GET/PUT，500 条缓冲够用），排查"列不出文件"类问题必需。
  - **fetch 抛异常记 warn**：method + URL + 异常类型，区分 `AbortError`（明确标注 `timeout after 10s`）与 `TypeError: Network request failed` 等真实网络错误。
  - 请求体不记内容，只记字节数（`body=1234B`）。
- `throwForStatus()`：签名增加响应体片段参数（或调用前读好传入），错误消息带上服务器片段（截 200 字符），使 UI 的 testResult 与同步错误状态直接可读。
- `webdav.ts` PROPFIND XML 解析 catch（L143）：`warn` 原始异常消息 + 响应前 200 字符后再抛。
- `settings/sync.tsx handleTest()`：catch 中 `logger.error('syncTest', describeError(ex))`，与 UI 文本并存。

**隐私红线**（延续铁律 8，正文不落日志）：

- 不记录 `Authorization` 头、密码、SecretKey；
- 不记录 PUT 请求体内容（便签正文），只记字节数；
- 响应体是服务器错误信息，可截断记录；
- URL 记录不包含 query 中的签名（S3 的 SigV4 签名在 Authorization 头，天然不含）。

### 2.4 其余补点（每处 1-3 行）

| 位置 | 改动 |
|---|---|
| `engine.ts` 下载 catch（L140） | `warn('sync', 下载失败 key=xxx: describeError)`；`skippedInvalid++` 的三个分支带 key 记 `debug` |
| `engine.ts` 上行循环（L214-220） | putTextAsync 抛出前 `warn` 失败 key（由后端层记请求，这里补业务上下文） |
| `dto.ts` `parseDto`（L105） | catch 保留失败原因并随 null 返回（或通过参数回调），engine 侧落日志 |
| `authVerifier.ts`（L29） | catch 记 `warn` 校验失败原因 |
| `vaultSecret.ts`（L20）、`cryptoHelper.ts`（L51,63） | 静默回落处记 `warn`（一次性回落原因） |
| `settings/index.tsx` 导出/导入 catch（L90,110） | 补 `logger.error('backup', ...)` 再 Alert |
| `webdav.ts` decodeURIComponent catch（L160） | 保持静默（纯容错，无诊断价值），不改 |

## 三、实施顺序（4 步分批，每步可独立验证）

1. **logger 增强**：debug 级 + subscribe/getEntries + 500 条 + `describeError` + warn/error 落盘（`logPersist.ts`）；`src/__tests__/logger.test.ts` 新增用例（缓冲上限、订阅、落盘格式、轮转）。
2. **日志页 + 设置入口**：新路由、实时列表、级别过滤、复制/导出分享/清空；设置页按钮替换。导出 = 持久化文件与内存缓冲合并。
3. **网络层日志**：webdav/s3 请求级日志 + throwForStatus 带响应体 + 测试连接落日志（直接解决 413 排查）。
4. **零散 catch 补点**：engine / dto / authVerifier / vaultSecret / 设置页导入导出。

每步完成后运行：`npx tsc --noEmit`、`npx expo lint`、`npx jest`（项目已有 `src/__tests__/` 共 14 个测试文件）。

## 四、已定决策（2026-10-06 评审确认）

1. 落盘路径：**`Paths.document/logs/`**（可靠，系统不清理）。
2. 落盘轮转策略：**超过 1MB 截断重写**（不保留 `.old`）。
3. 导出 txt：**包含 debug 级别**；且**必须合并落盘历史**——崩溃/进程重启后内存缓冲为空，之前的 warn/error 只在落盘文件里，导出不能只导内存缓冲。
4. 日志页**不**单独展示历史落盘文件，v1 只在导出时合并。
