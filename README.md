# StickyNotes 移动端

StickyNotes 桌面便签的移动版（Android / iOS），React Native + Expo (TypeScript) 实现。遵循平台原生设计规范，经典 7 色主题仅作用于便签卡片，与桌面端色值完全一致；通过《便签网络同步协议 v1》与桌面端 [StickyNotesDesktop](file:///C:/Home/Projects/StickyNotesDesktop) 双向同步，数据零丢失。

> 架构与选型详见 `docs/STICKYNOTES-MOBILE-APP-PROPOSAL-B.md`（React Native / Expo 方案）。

## 功能

- **便签列表**：双列瀑布流卡片流、置顶排序、实时搜索（关键词高亮）、全部/已置顶过滤、下拉刷新触发同步、卡片左滑归档、卡片菜单（置顶/归档）
- **便签编辑**：无干扰全屏编辑、7 色主题即时切换、一键置顶、归档、字数统计与同步状态指示；500ms 防抖自动保存，返回/切后台强制刷盘
- **归档箱**：查看已归档便签，支持恢复、彻底删除、清空
- **网络同步**：WebDAV 与 Cloudflare R2 / S3 双后端，测试连接（10 秒超时）、立即同步、后台周期同步（Android WorkManager，≥15 分钟）；LWW 时间戳裁决、墓碑传播、下行守卫、全失败熔断，与桌面端引擎行为一致；设置页展示最近同步时间与上传 / 下载 / 远端条数
- **端到端防偷窥加密**：可选开关，便签正文经 AES-256-CBC 加密后存入 `stickynotes-vault/`（明文存 `stickynotes-data/`，物理双轨隔离），云端只能看到密文；密钥与桌面端逐字节一致，两端可互相解密；含 `SN1:` 魔数守卫与 `.auth_verifier` 口令探针预检，密钥不匹配时整轮中止而非写入乱码
- **安全**：密码/密钥经系统安全硬件存储（Android Keystore / iOS Keychain），日志不记录便签正文；PIN 应用锁 + 生物识别解锁，切后台可按超时重新锁定
- **数据管理**：JSON 全量导出/导入（与桌面端格式兼容、按 ID 幂等去重）、每日本地自动备份（保留最近 7 份）
- **诊断**：设置页可复制运行日志与崩溃报告；渲染错误与未捕获异常有内置错误屏，可复制信息

## 目录结构

```
src/                  # Expo 工程
├── app/              # expo-router 路由（列表/编辑/归档/设置/同步设置）
├── src/
│   ├── components/   # NoteCard、ColorPaletteSheet、CrashScreen 等
│   ├── stores/       # zustand（notes / sync / settings / crash）
│   ├── sync/         # 同步协议层：dto / engine / WebDAV / S3(SigV4) / 调度
│   ├── data/         # 7 色主题、SQLite(WAL)、便签仓储（含下行守卫）
│   └── services/     # logger / crash / autoSave / credential / search
├── __tests__/        # jest 单测（SigV4 官方向量、LWW、防乒乓、熔断等）
├── plugins/          # 本地 config plugin（release 签名注入）
└── android/          # CNG 生成目录（不手改、不入库）
```

## 开发环境要求

- Node.js、Android SDK（模拟器或真机）、JDK 17
- Expo Go（调试）或直接构建 APK

## 常用命令

以下命令均在 `src/` 目录下执行：

```bash
# 安装依赖
npm install

# 启动开发服务器（配合模拟器/真机上的 Expo Go 扫码或 deep link）
npm start

# 开发构建并安装到已连接设备（debug 变体）
npm run android

# 构建 release 并安装到设备（使用 release 签名）
npm run android -- --variant release

# 仅构建签名 release APK / AAB
cd android && .\gradlew.bat assembleRelease
npx react-native build-android --mode=release

# 单元测试（83 个：跨平台加密向量、子目录路由、S3 key 口径、加密上下行与探针拦截、SigV4 官方向量、LWW、防乒乓、下行守卫、熔断等）
npm test

# 端到端（需本地 WebDAV，未设置环境变量时自动跳过）
WEBDAV_E2E_URL=http://127.0.0.1:6065/ npx jest __tests__/syncWebDavE2E.test.ts

# 类型检查 / 代码检查
npm run typecheck
npm run lint
```

## 同步服务配置

应用内 `设置 → 同步设置`：选择 WebDAV 或 Cloudflare R2 / S3，填入服务器地址与凭据（密码存入系统安全存储），可先「测试连接」再「立即同步」。存储根会自动追加子目录并与桌面端口径一致：明文 `stickynotes-data/`、加密 `stickynotes-vault/`。

启用「端到端防偷窥加密」后，正文以 AES-256 加密上传，密钥与桌面端共用（见 [加密同步设计](docs/SYNC-CRYPTO-DESIGN-20261005.md)）；切换开关等于更换数据集，不会自动迁移已有数据，建议先完成一轮同步再切换。

本地调试可参照桌面端方式，用 [hacdias/webdav](https://github.com/hacdias/webdav) 起一个本地实例（模拟器内通过 `http://10.0.2.2:<端口>` 访问宿主机，需打开「允许明文 HTTP」）：

```bash
webdav.exe --config config.yaml   # address/port/directory/permissions/users
```

## 签名说明

Release 签名复用 `androidnew.jks`（别名 `android`）：

- `src/key.properties`：签名参数（storeFile 指向 `src/keystore/androidnew.jks`）
- `src/plugins/withAndroidSigning.js`：本地 config plugin，`prebuild` 时自动向生成的 gradle 配置注入签名，改签名只需改这两个文件后重新 `npx expo prebuild -p android --clean`

**以上两处（连同 `keystore/`、`android/`、`credentials.json`）均已 gitignore，密钥与口令请自行备份，丢失后无法用原签名更新应用。**

## 相关文档

- [方案文档 B](docs/STICKYNOTES-MOBILE-APP-PROPOSAL-B.md) — 架构选型与协议铁律
- [加密同步设计](docs/SYNC-CRYPTO-DESIGN-20261005.md) — 端到端加密方案、落地结果与验证方法
- [变更日志](docs/CHANGES-20261005.md) — 重点变更摘要
- [同步协议设计](file:///C:/Home/Projects/StickyNotesDesktop/docs/SYNC-PROTOCOL-DESIGN-20261004.md) — 桌面端协议规范
