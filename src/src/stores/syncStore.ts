// 同步状态 store（UI 指示与诊断信息）
import { create } from 'zustand';
import {
  getLastSyncStats,
  getLastSyncTime,
  performSyncRound,
  setSyncStateListener,
  type SyncStats,
} from '../sync/syncRunner';
import { loadSyncSettings } from '../sync/settings';
import { logger } from '../services/logger';

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'success' | 'error';

export type { SyncStats };

interface SyncState {
  status: SyncStatus;
  /**
   * 是否有同步轮次正在进行。由 syncRunner 的 start/end 事件统一驱动，与触发入口无关
   * （防抖 / 前台 / 后台 / 手动都算），因此「立即同步」的守卫不再被防抖轮次绕过。
   */
  inFlight: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** 最近一次成功同步的指标（上传/下载/远端总数），持久化于 SQLite kv */
  stats: SyncStats | null;
  hydrate: () => void;
  markStarted: () => void;
  markFinished: () => void;
  markSuccess: (at: string, stats?: SyncStats) => void;
  markError: (message: string) => void;
  /** 手动触发一轮同步；返回本轮是否真正完成（未启用 / 配置不完整 / 已在同步中 / 失败均返回 false） */
  runNow: () => Promise<boolean>;
}

/** 终态显示时长：超过后回落 idle，避免指示点长期停在结果色 */
const STATUS_RESET_MS = 8_000;
let statusResetTimer: ReturnType<typeof setTimeout> | null = null;

export const syncStore = create<SyncState>((set, get) => {
  const clearStatusReset = (): void => {
    if (statusResetTimer) {
      clearTimeout(statusResetTimer);
      statusResetTimer = null;
    }
  };
  const scheduleIdleReset = (): void => {
    clearStatusReset();
    statusResetTimer = setTimeout(() => {
      statusResetTimer = null;
      set({ status: 'idle' });
    }, STATUS_RESET_MS);
  };

  return {
    status: 'idle',
    inFlight: false,
    lastSuccessAt: null,
    lastError: null,
    stats: null,

    hydrate: () => {
      const settings = loadSyncSettings();
      clearStatusReset();
      set({
        status: settings.enabled ? 'idle' : 'disabled',
        lastSuccessAt: getLastSyncTime(),
        stats: getLastSyncStats(),
      });
    },

    markStarted: () => {
      clearStatusReset();
      set({ inFlight: true, status: 'syncing', lastError: null });
    },

    markFinished: () => set({ inFlight: false }),

    markSuccess: (at, stats) => {
      set({
        status: 'success',
        lastSuccessAt: at,
        lastError: null,
        stats: stats ?? get().stats,
      });
      scheduleIdleReset();
    },

    markError: (message) => {
      set({ status: 'error', lastError: message });
      scheduleIdleReset();
    },

    runNow: async () => {
      // 先判 inFlight 再置状态：否则会覆盖正在跑的轮次，并在该轮次提前返回时把状态永久留在 syncing
      if (get().inFlight) return false;
      if (!loadSyncSettings().enabled) return false;

      clearStatusReset();
      set({ status: 'syncing', lastError: null });
      try {
        const summary = await performSyncRound('manual');
        return summary !== null;
      } catch (ex) {
        // 错误状态已由 syncRunner 写入，这里补充内存日志
        logger.warn('sync', `manual round rejected: ${ex instanceof Error ? ex.message : String(ex)}`);
        return false;
      } finally {
        // inFlight 一律由 start/end 事件维护，此处不插手，避免把「本轮刚结束后启动的下一轮」误清零；
        // 仅兜底复位：未启用/配置不完整时 performSyncRound 提前返回且不发任何事件，状态会停在 syncing
        if (get().status === 'syncing') set({ status: 'idle' });
      }
    },
  };
});

// 接收同步轮次结果（监听器注入，避免 syncRunner 反向依赖本模块形成循环导入）
setSyncStateListener((event) => {
  const s = syncStore.getState();
  if (event.type === 'start') {
    s.markStarted();
  } else if (event.type === 'success' && event.at) {
    s.markSuccess(event.at, event.stats);
  } else if (event.type === 'error' && event.message) {
    s.markError(event.message);
  } else if (event.type === 'end') {
    s.markFinished();
  }
});
