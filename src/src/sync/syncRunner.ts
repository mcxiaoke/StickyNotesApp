// 同步执行入口：前后台共用的无 UI 一轮同步（前台手动/防抖、后台定时均调用此函数）。
// 通过监听器上报结果，避免与 UI store 形成循环导入。
import { kvGet, kvSet } from '../data/db';
import { getDeviceId } from '../services/deviceId';
import { createBackendAsync } from './backendFactory';
import { getVaultSecret } from './crypto/vaultSecret';
import { SyncEngine, type SyncRoundSummary } from './engine';
import { loadSyncSettings } from './settings';
import { logger } from '../services/logger';

const KV_LAST_SYNC = 'sync.lastSuccessAt';
const KV_LAST_STATS = 'sync.lastStats.v1';

/** 最近一次成功同步的指标（对照桌面端 SyncState 的 LastUploadedCount/LastDownloadedCount/LastListedCount） */
export interface SyncStats {
  at: string;
  listed: number;
  uploaded: number;
  downloaded: number;
}

export type SyncStateListener = (event: {
  type: 'success' | 'error';
  at?: string;
  summary?: SyncRoundSummary;
  stats?: SyncStats;
  message?: string;
}) => void;

let listener: SyncStateListener | null = null;

/** syncStore 在模块加载时注册，用于接收同步结果更新 UI 状态 */
export function setSyncStateListener(fn: SyncStateListener | null): void {
  listener = fn;
}

export async function performSyncRound(trigger: string): Promise<SyncRoundSummary | null> {
  const settings = loadSyncSettings();
  if (!settings.enabled) return null;

  const backend = await createBackendAsync();
  if (!backend) return null;

  const engine = new SyncEngine();
  try {
    const summary = await engine.runAsync(backend, getDeviceId(), {
      enableEncryption: settings.enableEncryption,
      secret: settings.enableEncryption ? getVaultSecret() : undefined,
    });
    if (summary) {
      const nowIso = new Date().toISOString();
      const stats: SyncStats = {
        at: nowIso,
        listed: summary.listed,
        uploaded: summary.uploaded,
        downloaded: summary.downloaded,
      };
      kvSet(KV_LAST_SYNC, nowIso);
      kvSet(KV_LAST_STATS, JSON.stringify(stats));
      listener?.({ type: 'success', at: nowIso, summary, stats });
      // 不含便签正文，仅统计（铁律 8）
      logger.info(
        'sync',
        `round(${trigger}) ok: listed=${summary.listed} up=${summary.uploaded} down=${summary.downloaded} skipped=${summary.skippedInvalid} guarded=${summary.guardedSkipped} encrypted=${settings.enableEncryption}`,
      );
    }
    return summary;
  } catch (ex) {
    const message = ex instanceof Error ? ex.message : String(ex);
    listener?.({ type: 'error', message });
    logger.error('sync', `round(${trigger}) failed: ${message}`);
    throw ex;
  } finally {
    backend.dispose();
  }
}

export function getLastSyncTime(): string | null {
  return kvGet(KV_LAST_SYNC);
}

export function getLastSyncStats(): SyncStats | null {
  const raw = kvGet(KV_LAST_STATS);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SyncStats>;
    if (!parsed || typeof parsed.at !== 'string') return null;
    return {
      at: parsed.at,
      listed: typeof parsed.listed === 'number' ? parsed.listed : 0,
      uploaded: typeof parsed.uploaded === 'number' ? parsed.uploaded : 0,
      downloaded: typeof parsed.downloaded === 'number' ? parsed.downloaded : 0,
    };
  } catch (ex) {
    logger.warn('sync', `corrupted sync stats ignored: ${String(ex)}`);
    return null;
  }
}
