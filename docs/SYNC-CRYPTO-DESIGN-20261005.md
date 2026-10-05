# 便签移动端端到端防偷窥加密同步方案（对齐桌面端 v1.0）

- **日期**：2026-10-05 (GMT+8)
- **状态**：**已落地实现 (v1.0)**（2026-10-05 19:20 完成；单测 83 项 + 本地 WebDAV 端到端 7 项通过，含与桌面端双向交叉解密）
- **对应实现**：[`C:/Home/Projects/StickyNotesDesktop/docs/SYNC-CRYPTO-DESIGN-20261005.md`](file:///C:/Home/Projects/StickyNotesDesktop/docs/SYNC-CRYPTO-DESIGN-20261005.md)（桌面端 v1.0 已落地，151 项单测 + 5 语言环形互通验证通过）
- **目标**：移动端（React Native / Expo）在不改变既有同步协议（无状态全量对账 + LWW + 墓碑）的前提下，实现与桌面端**逐字节互通**的密文同步。

---

## 一、结论摘要

1. **推荐方案 A：纯 JS 复刻桌面端协议**。用 `@noble/ciphers`（同步 `cbc`，默认 PKCS7 填充）+ 已有 `@noble/hashes`，零新增原生模块，Expo Go 可直接调试，单测可直接跑桌面端官方测试向量。
2. **加密不是第一步**。核对代码后发现两个 P0 级路径缺陷，**不修复则加密做完也无法与桌面端交换数据**：
   - **P0-1 存储根目录口径不一致**：桌面端自动把用户 URL/前缀归一化后追加 `stickynotes-data/` 或 `stickynotes-vault/`，移动端完全不追加。
   - **P0-2 S3 后端读写路径错位**：`listAsync` 带 `basePrefix`、`get/put/delete` 不带，`basePrefix` 非空时"写进去的对象永远列不出来"。
3. 建议落地顺序：**阶段 0 修 P0（不涉及加密）→ 阶段 1 加密纯函数 + 单测 → 阶段 2 引擎/探针/设置接入 → 阶段 3 双端联调**。

---

## 二、桌面端协议基线（必须逐字节对齐的 8 个点）

| # | 约定项 | 桌面端定义 | 源文件 |
|---|---|---|---|
| 1 | 密钥派生 | `key = SHA-256(UTF-8(secret))`，32 字节 | `CryptoHelper.DeriveKey` |
| 2 | 对称算法 | AES-256-CBC，`PaddingMode.PKCS7`，IV 固定 16 字节随机 | `CryptoHelper.Encrypt/Decrypt` |
| 3 | 明文魔数 | 加密前 `plaintext = "SN1:" + content`；解密后必须以 `SN1:` 开头，否则判为密钥不符/损坏并抛 `SecurityException` | `CryptoHelper.CreateMagicPayload/UnwrapMagicPayload` |
| 4 | 传输格式 | `{ iv: base64, payload: base64 }`，**密文 DTO 不含 `content` 字段**；`iv`/`payload` 必须成对出现；`content` 与密文互斥 | `SyncNoteDto` / `SyncProtocol.TryDeserialize` |
| 5 | 目录双轨 | 明文 `stickynotes-data/notes/<uuid>.json`；密文 `stickynotes-vault/notes/<uuid>.json` | `SyncProtocol.DataPrefix/VaultPrefix` |
| 6 | 口令探针 | `<root>/.auth_verifier`，内容 `{version:1, iv, payload}`；探针明文固定为 `STICKYNOTES_AUTH_OK`；每轮同步前校验，不匹配即中断整轮 | `AuthVerifierDto` / `SyncEngine` |
| 7 | 字段与时间戳 | `schemaVersion=1`、`id` 小写 UUID、`color/isPinnedInList/alwaysOnTop/isDeleted` 明文、`createdAt/updatedAt` ISO-8601 UTC、`deviceId` 明文；正文换行统一 `\n` 后加密 | `SyncNoteDto` / `SyncProtocol.NormalizeContent` |
| 8 | 密钥分发 | 公开 fallback：`StickyNotes-Vault-Public-Fallback-Key#2026`；本地专属密钥为 64 字符口令，以 `[0x5A,0xA5,0x3C,0xC3]` 循环异或混淆成字节数组（`VaultSecret.local.cs`，gitignore） | `VaultSecret.cs` / `VaultSecret.local.cs` |

**关键结论**：UTC 时间戳、`isDeleted` 等元数据保持明文，同步引擎无需解密即可完成 LWW 对账 —— 移动端必须复刻这一点，不能改成"整个 JSON 加密"。

---

## 三、移动端现状核对（证据）

| 能力 | 现状 | 证据文件 |
|---|---|---|
| 加密纯函数 | **不存在**（`src/src/sync/crypto/` 下只有 `sigv4.ts`） | `src/src/sync/crypto/` |
| DTO 密文字段 | 无 `iv`/`payload`，`parseDto` 缺 `content` 时置空串 | `src/src/sync/dto.ts` |
| 同步引擎 | 直接明文上下行，无加密钩子、无探针 | `src/src/sync/engine.ts` |
| 存储子目录路由 | 无（直接把用户 URL 当根） | `src/src/sync/backendFactory.ts` |
| S3 前缀 | `listAsync` 用 `basePrefix+notes/`，`get/put/delete` 只用 `key` | `src/src/sync/backends/s3.ts` L38-85 |
| 设置项 | `SyncSettings` 无 `enableEncryption` | `src/src/sync/settings.ts` |
| 安全存储 | 已有 `expo-secure-store` 封装（WebDAV 密码 / S3 Secret） | `src/src/services/credential.ts` |
| 随机数与哈希 | 已有 `expo-crypto`（`getRandomBytes` 同步原生 CSPRNG）、`@noble/hashes` | `package.json` |
| 单测 | 已有 5 个测试文件（协议/SigV4/引擎等），无加密测试 | `src/__tests__/` |

---

## 四、P0 阻断问题（建议先修，与加密解耦）

### 4.1 P0-1：存储根目录口径不一致

- 桌面端 `StorageBackendFactory.GetEffectiveWebDavUrl` / `GetEffectiveS3Prefix` 会把用户配置归一化后**追加目标子目录**（并按 `EnableEncryption` 在 `stickynotes-data/` 与 `stickynotes-vault/` 间切换）。
- 移动端 `backendFactory.ts` 直接把 `settings.webdav.serverUrl` / `settings.s3.basePrefix`（默认 `stickynotes/`）交给后端，没有任何归一化。
- **后果**：
  - 明文模式下两端就写在不同目录（桌面端 `stickynotes-data/notes/…`，移动端 `stickynotes/notes/…`），**互相看不到对方数据**；
  - 加密模式下必须落在 `stickynotes-vault/`，移动端若不加这层路由，**无论加密与否都不可能互通**。

**修复方式（照搬桌面端语义，移动端新增 `src/src/sync/protocol.ts` + 在 `backendFactory.ts` 内做路由）**：

```ts
// protocol.ts
export const DATA_PREFIX = 'stickynotes-data/';
export const VAULT_PREFIX = 'stickynotes-vault/';
export const VERIFIER_KEY = '.auth_verifier';
export const AUTH_VERIFIER_MAGIC = 'STICKYNOTES_AUTH_OK';
export const getEffectiveSubdirectory = (enableEncryption: boolean) =>
  enableEncryption ? VAULT_PREFIX : DATA_PREFIX;

// backendFactory.ts（与桌面端 GetEffectiveWebDavUrl / GetEffectiveS3Prefix 逐条对齐）
export function getEffectiveWebDavUrl(serverUrl: string, enableEncryption: boolean): string
export function getEffectiveS3Prefix(basePrefix: string, enableEncryption: boolean): string
```

要点：
1. 幂等：URL/前缀已含目标子目录时不重复追加；
2. 自动纠正对侧子目录（已含 `stickynotes-data` 而目标是 vault 时先剥离再追加）；
3. `s3.basePrefix` 命中 `stickynotes` / `stickynotes-data` / `stickynotes-vault` 任一形态时，一律归一为目标子目录（桌面端同款规则）；
4. 后端实例内部 key 仍统一为 `notes/<uuid>.json` 与 `.auth_verifier`，**后端不感知子目录**。

### 4.2 P0-2：S3 后端 `basePrefix` 读写路径错位

`src/src/sync/backends/s3.ts` 现状：

```ts
// listAsync：prefix 含 basePrefix，但返回的 key 剥掉了 basePrefix
const params = [['prefix', this.notesObjectPrefix /* = basePrefix + 'notes/' */], ...];
items.push({ key: noteKey(name.slice(0, -'.json'.length)) });   // -> "notes/<uuid>.json"

// get/put/delete：直接把相对 key 接到 bucket 根上，未补 basePrefix
await this.signedFetch('GET', `/${key}`);                        // -> /bucket/notes/<uuid>.json  ← 错位
```

**后果**：`basePrefix` 为空时勉强可用；非空（默认 `stickynotes/`）时，写入落在 `/bucket/notes/…`，而列目录查 `/bucket/stickynotes/notes/…` —— **远端永远列为空，本地每轮全量重传且永远拉不到数据**。

**修复方式**（对齐桌面端 `S3Backend.FullKey(key) = _basePrefix + key`）：

```ts
private fullKey(key: string): string {
  return this.config.basePrefix ? `${this.normalizedBasePrefix}${key}` : key;
}
// get/put/delete 统一走 fullKey(key)；listAsync 仍用 prefix 列目录并返回相对 key
```

> 顺带核对：WebDAV 后端（`webdav.ts`）把子目录放在 `rootUrl` 里、key 相对 root，**逻辑正确**，添加子目录路由后无需改动。

---

## 五、方案 A 详细设计（推荐）

### 5.1 密码学依赖选型

| 候选 | 能否 AES-256-CBC | 评价 |
|---|---|---|
| **`@noble/ciphers`（推荐）** | ✅ `import { cbc } from '@noble/ciphers/aes.js'`，同步函数，**默认 PKCS7 填充**（与 `PaddingMode.PKCS7` 一致，含"整块补一整块"规则） | 零依赖、纯 JS、与已有 `@noble/hashes` 同生态；已用 NIST KAT 自测 |
| `expo-crypto` 原生 AES | ❌ 仅 AES-GCM（官方明确 "Modes other than AES-GCM are not supported"） | 与桌面端 CBC 协议不兼容，排除 |
| `@noble/ciphers/webcrypto` 的 `cbc` | ❌ 依赖 `crypto.subtle` | Hermes 无 `crypto.subtle`，排除 |
| `aes-js` | ✅ 支持 CBC | 但不做 padding（需自写 PKCS7），且已 8 年未更新；作为备选 |
| `react-native-quick-crypto` | ✅ `createCipheriv('aes-256-cbc')`，与 Node 语义一致 | 需原生模块（须 dev build / prebuild），**性能更好但复杂度上升**；仅在实测性能不达标时启用 |
| 自写 AES | ✅ 但风险高 | 不推荐 |

**结论**：`@noble/ciphers@^2.4.0` + 已有 `@noble/hashes@^2.4.0` + 已有 `expo-crypto`（仅取随机数）+ 自写 Base64 工具（约 40 行，避免 `btoa` 的 latin1 陷阱）。

随机 IV 取 `Crypto.getRandomBytes(16)`（同步、原生 CSPRNG，`expo-crypto` 已安装）。

### 5.2 改动清单

| 类型 | 文件 | 说明 |
|---|---|---|
| 新增 | `src/src/sync/protocol.ts` | 常量 + `getEffectiveSubdirectory`（§4.1） |
| 新增 | `src/src/sync/crypto/base64.ts` | `bytesToBase64` / `base64ToBytes`（Uint8Array 直转，不经字符串） |
| 新增 | `src/src/sync/crypto/cryptoHelper.ts` | `deriveKey` / `encrypt` / `decrypt` / `createMagicPayload` / `unwrapMagicPayload` |
| 新增 | `src/src/sync/crypto/vaultSecret.ts` | 公开 fallback 口令 + 分部加载钩子 |
| 新增 | `src/src/sync/crypto/vaultSecret.local.ts` | 本地专属密钥（XOR 混淆字节数组），gitignore，含占位版本保证可编译 |
| 新增 | `src/src/sync/authVerifier.ts` | `create(secret)` / `verify(json, secret)` |
| 新增 | `src/__tests__/syncCrypto.test.ts` | 官方测试向量 + 交叉验证 |
| 新增 | `src/__tests__/fixtures/crypto-vectors.json` | 从桌面端 `scripts/crypto_compat/vectors.json` 复制的**只读副本**（注明来源与同步方式） |
| 改造 | `src/src/sync/dto.ts` | 加 `iv`/`payload`/`isEncrypted`；`parseDto` 加互斥校验；新增 `dtoFromNoteEncrypted` |
| 改造 | `src/src/sync/backends/s3.ts` | 修 `fullKey`（§4.2） |
| 改造 | `src/src/sync/backendFactory.ts` | 子目录路由（§4.1） |
| 改造 | `src/src/sync/settings.ts` | 新增 `enableEncryption: boolean`（默认 `false`，向后兼容旧配置） |
| 改造 | `src/src/sync/engine.ts` | 探针守卫 + 下行解密回填 + 上行加密 |
| 改造 | `src/src/app/settings/sync.tsx` | 新增"端到端防偷窥加密"开关与说明区块 |
| 依赖 | `package.json` | `@noble/ciphers`（唯一新增） |

### 5.3 核心函数契约

```ts
// cryptoHelper.ts
export const MAGIC_HEADER = 'SN1:';
export class SyncCryptoError extends Error {}                 // 统一解密失败信号

export function deriveKey(secret: string): Uint8Array          // sha256(utf8(secret))
export function encrypt(plainText: string, secret: string, fixedIv?: Uint8Array):
  { iv: string; payload: string }                              // base64
export function decrypt(ivB64: string, payloadB64: string, secret: string): string
export function createMagicPayload(content: string, secret: string, fixedIv?: Uint8Array):
  { iv: string; payload: string }                              // "SN1:" + content 后加密
export function unwrapMagicPayload(ivB64: string, payloadB64: string, secret: string): string
  // 解密异常 或 前缀非 "SN1:" -> 抛 SyncCryptoError（两个分支都要有，防 1/256 伪解密）
```

```ts
// dto.ts 改造要点
export interface SyncNoteDto {
  // ...原字段
  content?: string;      // 密文模式为 undefined（序列化时省略）
  iv?: string;
  payload?: string;
}
export function dtoFromNoteEncrypted(note: NoteLike, deviceId: string, secret: string): SyncNoteDto
// serializeDto：密文模式输出 iv+payload，绝不输出 content；明文模式相反
// parseDto 新增校验（对齐 SyncProtocol.TryDeserialize）：
//   iv 与 payload 必须成对；content 与 iv/payload 不得并存；两者皆无时 content 规范为 ''
```

```ts
// engine.ts 三处改动（其余对账逻辑一行不动）
// 1) runCoreAsync 开头：if (settings.enableEncryption) await ensureVerifierAsync(backend, secret)
//    - getTextAsync(VERIFIER_KEY) 为 null -> create 并 putTextAsync 自举
//    - 校验失败 -> 直接抛异常中断整轮（绝不逐个便签解密失败）
// 2) 下行：dto.isEncrypted -> unwrapMagicPayload 解密回填 content
//    失败 -> skippedInvalid++ 并跳过（绝不落库乱码）
// 3) 上行：enableEncryption ? dtoFromNoteEncrypted(...) : dtoFromNote(...)
```

### 5.4 密钥分发（需要你拍板的一点）

桌面端做法是"公开 fallback + 本地 gitignore 专属密钥"。移动端有两种等价性不同的选择：

| 选项 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **1（推荐，对齐桌面端）** | `vaultSecret.local.ts` 内放 XOR 混淆字节数组（由 `temp/sticky_notes_vault_secret.txt` 的 64 字符口令生成，掩码 `[0x5A,0xA5,0x3C,0xC3]`，与桌面端一致），文件 gitignore；仓库提交一个**不含密钥的占位版本**保证他人克隆可编译 | 勾选开关即可用，多设备免输入，与桌面端体验一致 | 密钥在 APK 内（混淆但可提取），与桌面端风险等级相同 |
| 2 | 密钥经 `expo-secure-store` 保存，首次在设置页粘贴桌面端 `temp/sticky_notes_vault_secret.txt` 内容 | 密钥不进构建产物 | 每台设备都要输入一次；忘记输入会触发探针拦截 |

> 建议以**选项 1 为默认**、同时保留"设置页可覆盖（覆盖值优先）"的能力。若走选项 1，需注意 Metro 静态解析 require/import：**占位文件必须存在并入库**（内容返回 `null`），真实密钥通过本地覆盖 + `git update-index --skip-worktree` 管理，避免"本地改完误提交"。

### 5.5 错误与边界（沿用桌面端铁律）

1. **明密文互斥**：解析阶段就拒绝 `content` 与 `iv/payload` 并存的文件，从源头杜绝密文被当正文刷进 UI。
2. **魔数双重防御**：CBC 下约 1/256 概率错误密钥"碰巧"通过 PKCS7 校验，必须靠 `SN1:` 前缀兜底，两处都要判。
3. **探针前置**：加密模式下每轮同步第一步校验 `.auth_verifier`；不匹配立即中断，防止批量解密失败污染。
4. **坏文件隔离**：单条解密失败计入 `skippedInvalid` 并跳过，不中断整轮；"远端全部下载失败"仍按既有铁律 7 中止。
5. **不做目录就地迁移**：切换开关 = 换数据集（物理隔离），不搬文件、不物理删除。
6. **防乒乓不变**：`businessEquals` 比较的是**解密后的明文**，随机 IV 不会导致无意义重传。

### 5.6 明确不做

非对称密钥协商、PBKDF2/Argon2、物理删除云端文件、本地引入 `sync_status` 状态机、云端游标文件 —— 与桌面端 §1.2 保持一致。

---

## 六、验证计划

| 层级 | 内容 | 通过标准 |
|---|---|---|
| L1 单测 | 移植 `vectors.json`：3 条 NIST KAT（无填充原始 AES）+ 4 条 app_scheme（含空串、恰好 16 字节、单字符、中英 Emoji 多行）；补齐 `SN1:` 魔数、Base64 往返、密钥混淆解码 | 全部与桌面端期望密文逐字节一致 |
| L2 交叉 | 用桌面端**真实生成的密文**（`crypto_compat` 产物或 vault 目录样例）在移动端解密 | 还原明文完全一致 |
| L3 端到端（模拟器/真机） | 明文 → 开启加密 → 同步 | 远端出现 `stickynotes-vault/notes/*.json`，文件中**无 `content` 字段**、`updatedAt` 等仍为明文 |
| L4 双端 | 桌面端写入 → 移动端解密可见；移动端写入 → 桌面端解密可见；双端各改同一条（LWW 收敛） | 双向零丢失、零复活 |
| L5 负向 | 故意用错密钥 | 探针立即拦截整轮同步；本地库无任何乱码写入 |
| L6 回归 | 既有 5 个测试文件 + 明文模式同步 | 全绿，明文模式行为零变化 |

验证基准脚本可复用桌面端 `scripts/crypto_compat/run_all.ps1`（含 Node.js 实现，可作为独立第三方参照）。

---

## 七、分阶段落地（每阶段可独立验证、可独立回滚）

| 阶段 | 内容 | 回滚方式 |
|---|---|---|
| **0** | 修 P0-1 子目录路由 + P0-2 S3 `fullKey`（**不含加密**） | 改回原 URL/前缀拼接 |
| **1** | `protocol.ts` / `base64.ts` / `cryptoHelper.ts` / `vaultSecret*.ts` + L1、L2 验证 | 纯新增文件，删除即回滚 |
| **2** | `dto.ts` / `settings.ts` / `engine.ts` / `authVerifier.ts` / 设置页开关 + L5、L6 | 开关默认 `false`，关闭即回到明文路径 |
| **3** | 双端联调（L3、L4） | 关闭开关 + 切回 `stickynotes-data/` |

> 阶段 0 落地前，请先确认：现有移动端本地数据是否需要保留、远端 `stickynotes/` 与 `stickynotes-data/` 下的历史对象是否要手工清理（默认**不删**，仅切换读取目录；切目录后本地库会全量重传到新目录，旧目录数据保留备查）。

---

## 八、风险清单

| 风险 | 影响 | 应对 |
|---|---|---|
| 存储根口径不一致（P0-1） | 两端永远不互通，且现在就已存在 | 阶段 0 优先修复，先在明文模式下验证双端可见 |
| S3 前缀读写错位（P0-2） | S3/R2 模式下 `basePrefix` 非空即失效 | 阶段 0 修复并补单测（mock fetch 断言完整对象 key） |
| Metro 对缺失的 `vaultSecret.local.ts` 报解析失败 | 构建失败 | 占位文件必须入库（§5.4） |
| 切换加密开关导致"看到空数据" | 用户误解为数据丢失 | 设置页明确提示"切换的是数据集，不迁移"；切换前建议先完成一轮同步 |
| 纯 JS AES 性能 | 极大便签（上限 4 MB）加密耗时上升 | 单测中加入 4 MB 边界用例；若不达标再评估 `react-native-quick-crypto` |
| 密钥随 APK 分发 | 逆向可提取（混淆仅提高门槛） | 与桌面端风险等级一致，属既定设计（"防云侧偷窥"非"防本地逆向"） |
| vectors 副本与桌面端漂移 | 双端协议悄悄分叉 | fixtures 内注明来源与复制时间；桌面端 vectors 变更时同步更新 |

---

## 九、落地结果与实现差异

### 9.1 实际落地文件

| 类型 | 文件 | 说明 |
|---|---|---|
| 新增 | `src/src/sync/protocol.ts` | 双轨子目录常量 + `getEffectiveWebDavUrl` / `getEffectiveS3Prefix` |
| 新增 | `src/src/sync/crypto/base64.ts` | 纯 TS Base64 编解码（不依赖 btoa/atob/Buffer） |
| 新增 | `src/src/sync/crypto/utf8.ts` | 纯 TS UTF-8 编解码（不依赖 TextEncoder/TextDecoder） |
| 新增 | `src/src/sync/crypto/cryptoHelper.ts` | `deriveKey` / `encrypt` / `decrypt` / `createMagicPayload` / `unwrapMagicPayload` |
| 新增 | `src/src/sync/crypto/vaultSecret.ts` | 口令提供器（本地专属 → 公开回落） |
| 新增 | `src/src/sync/crypto/vaultSecret.local.ts` | XOR 掩码混淆的 64 字节专属密钥 |
| 新增 | `src/src/sync/authVerifier.ts` | 探针创建/校验 + `ensureVerifierAsync`（引擎与设置页共用） |
| 新增 | `src/src/sync/timeout.ts` | `withTimeout` 超时包装 |
| 新增 | `src/__tests__/syncCrypto.test.ts`、`syncRouting.test.ts`、`syncEngineCrypto.test.ts`、`syncWebDavE2E.test.ts`、`fixtures/crypto-vectors.json` | 40 项单测 + 7 项端到端 |
| 改造 | `sync/dto.ts` | `iv`/`payload` 字段、明密文互斥解析、`dtoFromNoteEncrypted`、`decryptDtoContent` |
| 改造 | `sync/engine.ts` | 探针守卫 + 下行解密回填 + 上行加密（`SyncRoundOptions`） |
| 改造 | `sync/backendFactory.ts` | 按 `enableEncryption` 路由存储根 |
| 改造 | `sync/backends/s3.ts` | `fullKey` 统一读写路径；单请求超时 10 秒 |
| 改造 | `sync/backends/webdav.ts` | Basic 认证改自实现 Base64+UTF-8；单请求超时 10 秒 |
| 改造 | `sync/settings.ts`、`stores/syncStore.ts`、`sync/syncRunner.ts` | `enableEncryption` 开关、同步指标持久化 |
| 改造 | `app/settings/sync.tsx`、`app/settings/index.tsx` | 加密开关、10 秒测试连接、状态与指标展示、保存后自动同步 |
| 依赖 | `package.json` | 新增 `@noble/ciphers@^2.4.0` |

### 9.2 与方案的三处偏差（均为实测驱动的调整）

1. **探针校验时机**：方案照抄桌面端"列目录前校验"，实现改为**列目录之后、下载之前**。原因是移动端 WebDAV 后端在 `listAsync` 内才自举 `MKCOL` 目录，若在 list 之前 `PUT .auth_verifier`，首次同步必得 409。调整后效益等价：任何解密与上传动作前即已中断整轮。
2. **密钥入库策略**：方案给了两个选项，实际采用**选项 1 且文件随源码入库**（`vaultSecret.local.ts` 为 XOR 混淆数组）。理由：保证任何机器克隆后可构建、可互通，避免 C# 分部类在 TS/Metro 下"文件缺失即构建失败"的问题。**安全边界**：密钥强度定位为"防云端偷窥"，与桌面端一致；如需进一步提高门槛，可将该文件改为 gitignore + `git update-index --skip-worktree` 并另存模板。
3. **自实现编解码**：Base64 与 UTF-8 均自实现，不依赖 `btoa` / `TextDecoder`（RN Hermes 环境差异不可控）。同时把 WebDAV Basic 认证从 `btoa` 切换为自实现编码。

另有一处接口放宽：`businessEquals` 入参由 `NoteLike` 放宽为 `ComparableNote`（`content: string | null`），使解密前的 DTO 与解密后的本地明文都能直接参与比较。

### 9.3 验证结果（可复现）

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | 0 error |
| Lint | `npx expo lint` | 0 error 0 warning |
| 全量单测 | `npx jest` | 8 suites / 83 tests 全通过 |
| 端到端（真实 HTTP） | `WEBDAV_E2E_URL=http://127.0.0.1:6065/ npx jest __tests__/syncWebDavE2E.test.ts` | 7 tests 全通过 |
| 密钥一致性 | 脚本比对移动端混淆数组与 `VaultSecret.local.cs` | 逐字节一致，解码后为同一口令 |

端到端用例覆盖：明文上下行、密文上下行、探针自举与拦截、双轨数据集隔离，以及**双向交叉验证**——桌面端 Node 参照实现加密 → 移动端解密入库；移动端加密 → 桌面端参照实现解密还原；桌面端生成的探针被移动端校验通过。

**模拟器实测（release APK，Android 模拟器 + 本地 WebDAV 真实链路）**：以 adb 驱动 UI 完成全流程并核验落盘结果——服务器地址在中文输入法下输入为全角 `HTTP：／／10。0。2。2：6065／`，经归一化后正常连通，「测试连接」返回「连接成功（4785 ms）」；开启端到端加密并同步后，远端出现 `stickynotes-vault/.auth_verifier` 与 `stickynotes-vault/notes/<uuid>.json`（**无 `content` 字段**，仅 `iv` + `payload`，其余元数据保持明文）；用桌面端 Node 参照实现解密该文件得到 `SN1:Vault Sync Test2026`，探针校验同样通过。反向以桌面端实现写入一条密文便签后，应用同步显示「最近同步：…（上传 0，下载 1）」并在列表中呈现解密后的正文，双向互通闭环成立。

**本地联调环境**（供后续复现）：

```bash
# 1) 启动 WebDAV 服务（temp/webdav-config.yaml，账号 stickynotes / stickynotes123）
C:/Home/Develop/tools/webdav.exe -c temp/webdav-config.yaml

# 2) 跑端到端
cd src && WEBDAV_E2E_URL=http://127.0.0.1:6065/ npx jest __tests__/syncWebDavE2E.test.ts
```

模拟器内手动验证时：服务器地址填 `http://10.0.2.2:6065/`（模拟器访问宿主机的映射地址），需打开「允许明文 HTTP」，再按需打开「端到端防偷窥加密」。

---

## 附：桌面端参考文件索引

- 设计规范：`StickyNotesDesktop/docs/SYNC-CRYPTO-DESIGN-20261005.md`
- 加密纯函数：`StickyNotesDesktop/src/StickyNotes/Sync/CryptoHelper.cs`
- DTO 与协议常量：`StickyNotesDesktop/src/StickyNotes/Sync/SyncModels.cs`
- 子目录路由：`StickyNotesDesktop/src/StickyNotes/Sync/StorageBackendFactory.cs`
- S3 前缀拼接：`StickyNotesDesktop/src/StickyNotes/Sync/S3Backend.cs`（`FullKey`）
- 密钥提供器：`StickyNotesDesktop/src/StickyNotes/Sync/VaultSecret.cs` / `VaultSecret.local.cs`
- 多语言测试向量：`StickyNotesDesktop/scripts/crypto_compat/vectors.json`（Node 参照实现 `nodejs/crypto_helper.js`）
- 本地专属口令（gitignore）：`StickyNotesDesktop/temp/sticky_notes_vault_secret.txt`（64 字符，无换行）
