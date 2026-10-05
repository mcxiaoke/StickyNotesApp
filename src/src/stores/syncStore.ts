// 同步状态 store（UI 指示与诊断信息）
import { create } from 'zustand';
import type { SyncRoundSummary } from '../sync/engine';
import { performSyncRound, setSyncStateListener } from '../sync/syncRunner';
import { loadSyncSettings } from '../sync/settings';
import { logger } from '../services/logger';

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'success' | 'error';

interface SyncState {
  status: SyncStatus;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastSummary: SyncRoundSummary | null;
  hydrate: () => void;
  setSyncing: () => void;
  markSuccess: (at: string, summary: SyncRoundSummary) => void;
  markError: (message: string) => void;
  /** 手动触发一轮同步；返回是否真正启动 */
  runNow: () => Promise<boolean>;
}

export const syncStore = create<SyncState>((set, get) => ({
  status: 'idle',
  lastSuccessAt: null,
  lastError: null,
  lastSummary: null,
  hydrate: () => {
    const settings = loadSyncSettings();
    set({ status: settings.enabled ? 'idle' : 'disabled' });
  },
  setSyncing: () => set({ status: 'syncing', lastError: null }),
  markSuccess: (at, summary) =>
    set({ status: 'success', lastSuccessAt: at, lastSummary: summary, lastError: null }),
  markError: (message) => set({ status: 'error', lastError: message }),
  runNow: async () => {
    if (!loadSyncSettings().enabled) return false;
    if (get().status === 'syncing') return false;
    set({ status: 'syncing', lastError: null });
    try {
      await performSyncRound('manual');
      return true;
    } catch (ex) {
      // 错误状态已由 syncRunner 写入，这里补充内存日志
      logger.warn('sync', `manual round rejected: ${ex instanceof Error ? ex.message : String(ex)}`);
      return false;
    }
  },
}));

// 接收后台同步结果（监听器注入，避免 syncRunner 反向依赖本模块形成循环导入）
setSyncStateListener((event) => {
  if (event.type === 'success' && event.at && event.summary) {
    syncStore.getState().markSuccess(event.at, event.summary);
  } else if (event.type === 'error' && event.message) {
    syncStore.getState().markError(event.message);
  }
});
