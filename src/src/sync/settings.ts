// 同步设置持久化（非敏感部分存 SQLite kv；密码/密钥经 credential.ts 存系统安全存储）
import { kvGet, kvSet } from '../data/db';
import { logger } from '../services/logger';

export type SyncBackendType = 'webdav' | 's3';

export interface SyncSettings {
  enabled: boolean;
  /** 端到端防偷窥加密：正文加密后写入 stickynotes-vault/，明文写入 stickynotes-data/ */
  enableEncryption: boolean;
  backendType: SyncBackendType;
  webdav: {
    serverUrl: string;
    username: string;
    allowHttp: boolean;
  };
  s3: {
    endpoint: string;
    bucket: string;
    basePrefix: string;
    accessKeyId: string; // 非敏感标识，随设置明文存储；SecretAccessKey 走安全存储
  };
  backgroundSyncMinutes: number; // 5/10/15/30/60
}

export const DEFAULT_SYNC_SETTINGS: SyncSettings = {
  enabled: false,
  enableEncryption: false,
  backendType: 'webdav',
  webdav: { serverUrl: '', username: '', allowHttp: false },
  s3: {
    endpoint: 'https://<ACCOUNT_ID>.r2.cloudflarestorage.com',
    bucket: '',
    basePrefix: 'stickynotes/',
    accessKeyId: '',
  },
  backgroundSyncMinutes: 15,
};

const KV_KEY = 'sync.settings.v1';

export function loadSyncSettings(): SyncSettings {
  const raw = kvGet(KV_KEY);
  if (!raw) return { ...DEFAULT_SYNC_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    return {
      ...DEFAULT_SYNC_SETTINGS,
      ...parsed,
      webdav: { ...DEFAULT_SYNC_SETTINGS.webdav, ...parsed.webdav },
      s3: { ...DEFAULT_SYNC_SETTINGS.s3, ...parsed.s3 },
    };
  } catch (ex) {
    logger.warn('syncSettings', `corrupted sync settings ignored: ${String(ex)}`);
    return { ...DEFAULT_SYNC_SETTINGS };
  }
}

export function saveSyncSettings(settings: SyncSettings): void {
  kvSet(KV_KEY, JSON.stringify(settings));
}
