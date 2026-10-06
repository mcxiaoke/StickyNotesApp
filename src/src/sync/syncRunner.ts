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
  type: 'start' | 'end' | 'success' | 'error';
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

let afterSyncHook: (() => void | Promise<void>) | null = null;

/**
 * 注册「一轮同步结束后的收口回调」（刷新内存列表等）。
 * 与 setSyncStateListener 同一模式：由上层注入，避免 syncRunner 反向依赖 store 形成循环导入。
 * 收口放在这里后，各处入口不再需要各自记得 refreshAsync。
 */
export function setAfterSync(fn: (() => void | Promise<void>) | null): void {
  afterSyncHook = fn;
}

async function runAfterSyncHook(): Promise<void> {
  if (!afterSyncHook) return;
  try {
    await afterSyncHook();
  } catch (ex) {
    logger.warn('sync', `afterSync hook failed: ${ex instanceof Error ? ex.message : String(ex)}`);
  }
}

/**
 * 模块级单飞：SyncEngine 的互斥是实例字段，而每轮都会 new 一个实例，因此它挡不住并发。
 * 真正的互斥放在这里——并发调用不再各自起一轮，而是合并到正在跑的那一轮（返回同一个 Promise），
 * 既消除重复全量对账/重复 PUT，也让调用方能拿到真实结果而不是 null。
 */
let inFlight: Promise<SyncRoundSummary | null> | null = null;

export function performSyncRound(trigger: string): Promise<SyncRoundSummary | null> {
  if (inFlight) {
    logger.info('sync', `round(${trigger}) coalesced into in-flight round`);
    return inFlight;
  }
  const round = runRoundAsync(trigger).finally(() => {
    inFlight = null;
  });
  inFlight = round;
  return round;
}

async function runRoundAsync(trigger: string): Promise<SyncRoundSummary | null> {
  const settings = loadSyncSettings();
  if (!settings.enabled) return null;

  const backend = await createBackendAsync();
  if (!backend) return null;

  const engine = new SyncEngine();
  // 仅在确认本轮会真正执行后才广播 start，避免「未启用/配置不完整」提前返回时让 UI 卡在同步中
  listener?.({ type: 'start' });
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
    listener?.({ type: 'end' });
    backend.dispose();
    // 下行写入（以及上行失败前已应用的下行）必须刷新到内存列表才会出现在界面上，
    // 因此在成功与失败两条路径上都执行收口；仅「提前返回、什么都没跑」时不执行。
    await runAfterSyncHook();
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
