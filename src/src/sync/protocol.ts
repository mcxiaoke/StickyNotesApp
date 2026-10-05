// 同步协议 v1 常量与「双轨子目录」路由（逐条对照桌面端 SyncProtocol / StorageBackendFactory）。
// 明文模式落在 stickynotes-data/，密文保险箱模式落在 stickynotes-vault/，物理隔离、零耦合。

export const SCHEMA_VERSION = 1;

/** 明文同步子目录前缀 */
export const DATA_PREFIX = 'stickynotes-data/';

/** 密文保险箱同步子目录前缀 */
export const VAULT_PREFIX = 'stickynotes-vault/';

/** 云端口令校验探针文件名（密文目录根部） */
export const VERIFIER_KEY = '.auth_verifier';

/** 探针内固定的成功魔数标识 */
export const AUTH_VERIFIER_MAGIC = 'STICKYNOTES_AUTH_OK';

/** 当前加密模式对应的存储子目录（含尾斜杠） */
export function getEffectiveSubdirectory(enableEncryption: boolean): string {
  return enableEncryption ? VAULT_PREFIX : DATA_PREFIX;
}

/**
 * URL 输入归一化：中文输入法会把英文标点输入成全角（`：` `／` `。`），
 * 直接用于请求会解析失败。这里统一折算为半角 ASCII，并去掉全角空格。
 */
export function normalizeUrlInput(value: string): string {
  return value
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3002/g, '.')
    .replace(/\u3000/g, '')
    .trim();
}

/** 去除首尾斜杠的短名称（stickynotes-data / stickynotes-vault） */
function subdirName(enableEncryption: boolean): string {
  return getEffectiveSubdirectory(enableEncryption).replace(/^\/+|\/+$/g, '');
}

/**
 * WebDAV 根 URL 归一化并按模式追加子目录（对照桌面端 GetEffectiveWebDavUrl）。
 * 幂等：已含目标子目录不重复追加；已含对侧子目录则先剥离再追加。
 */
export function getEffectiveWebDavUrl(serverUrl: string, enableEncryption: boolean): string {
  const normalized = normalizeUrlInput(serverUrl);
  if (!normalized) return '';
  let trimmed = normalized.replace(/\/+$/, '');
  const target = subdirName(enableEncryption);
  const other = subdirName(!enableEncryption);

  if (trimmed.toLowerCase().endsWith(`/${other.toLowerCase()}`)) {
    trimmed = trimmed.slice(0, -(other.length + 1));
  }
  if (!trimmed.toLowerCase().endsWith(`/${target.toLowerCase()}`)) {
    trimmed += `/${target}`;
  }
  return `${trimmed}/`;
}

/**
 * S3 对象前缀归一化并按模式追加子目录（对照桌面端 GetEffectiveS3Prefix）。
 * 用户原有的 "stickynotes" / 对侧子目录等形态一律归一到当前目标子目录。
 */
export function getEffectiveS3Prefix(basePrefix: string | undefined, enableEncryption: boolean): string {
  const target = subdirName(enableEncryption);
  const other = subdirName(!enableEncryption);

  if (!basePrefix || !basePrefix.trim()) return `${target}/`;

  let trimmed = normalizeUrlInput(basePrefix).replace(/^\/+/, '').replace(/\/+$/, '');
  const lower = trimmed.toLowerCase();
  if (lower === 'stickynotes' || lower === target.toLowerCase() || lower === other.toLowerCase()) {
    return `${target}/`;
  }
  if (trimmed.toLowerCase().endsWith(`/${other.toLowerCase()}`)) {
    trimmed = trimmed.slice(0, -(other.length + 1));
  }
  if (!trimmed.toLowerCase().endsWith(`/${target.toLowerCase()}`)) {
    trimmed += `/${target}`;
  }
  return `${trimmed}/`;
}
