// 同步执行入口：前后台共用的无 UI 一轮同步（前台手动/防抖、后台定时均调用此函数）。
// 通过监听器上报结果，避免与 UI store 形成循环导入。
import { kvGet, kvSet } from '../data/db';
import { getDeviceId } from '../services/deviceId';
import { createBackendAsync } from './backendFactory';
import { SyncEngine, type SyncRoundSummary } from './engine';
import { loadSyncSettings } from './settings';

const KV_LAST_SYNC = 'sync.lastSuccessAt';

export type SyncStateListener = (event: {
  type: 'success' | 'error';
  at?: string;
  summary?: SyncRoundSummary;
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
    const summary = await engine.runAsync(backend, getDeviceId());
    if (summary) {
      const nowIso = new Date().toISOString();
      kvSet(KV_LAST_SYNC, nowIso);
      listener?.({ type: 'success', at: nowIso, summary });
    }
    return summary;
  } catch (ex) {
    const message = ex instanceof Error ? ex.message : String(ex);
    listener?.({ type: 'error', message });
    throw ex;
  } finally {
    backend.dispose();
  }
}

export function getLastSyncTime(): string | null {
  return kvGet(KV_LAST_SYNC);
}
