// 应用设置 store：主题模式与正文字号（持久化到 SQLite kv）
import { create } from 'zustand';
import { kvGet, kvSet } from '../data/db';
import { logger } from '../services/logger';

export type ThemeMode = 'system' | 'light' | 'dark';
export const FONT_SIZES = [12, 14, 16, 18] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  12: '小',
  14: '标准',
  16: '大',
  18: '超大',
};

/** 切后台多久后要求重新解锁；0 = 立即，-1 = 从不（仅冷启动锁定），默认 10 分钟 */
export const AUTO_LOCK_NEVER = -1;
export const AUTO_LOCK_IMMEDIATE = 0;
export const AUTO_LOCK_DEFAULT = 10;
export const AUTO_LOCK_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '立即' },
  { value: 1, label: '1 分钟' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 60, label: '1 小时' },
  { value: AUTO_LOCK_NEVER, label: '从不' },
];

interface AppSettings {
  themeMode: ThemeMode;
  fontSize: FontSize;
  autoLockMinutes: number;
  hydrated: boolean;
  hydrate: () => void;
  setThemeMode: (mode: ThemeMode) => void;
  setFontSize: (size: FontSize) => void;
  setAutoLockMinutes: (minutes: number) => void;
}

const KV_KEY = 'app.settings.v1';

interface PersistShape {
  themeMode: ThemeMode;
  fontSize: FontSize;
  autoLockMinutes: number;
}

function loadPersisted(): PersistShape | null {
  const raw = kvGet(KV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistShape;
  } catch (ex) {
    logger.warn('settings', `corrupted app settings ignored: ${String(ex)}`);
    return null;
  }
}

export const settingsStore = create<AppSettings>((set) => ({
  themeMode: 'system',
  fontSize: 14,
  autoLockMinutes: AUTO_LOCK_DEFAULT,
  hydrated: false,
  hydrate: () => {
    const saved = loadPersisted();
    set({
      themeMode: saved?.themeMode ?? 'system',
      fontSize: saved?.fontSize ?? 14,
      autoLockMinutes: saved?.autoLockMinutes ?? AUTO_LOCK_DEFAULT,
      hydrated: true,
    });
  },
  setThemeMode: (mode) => {
    set({ themeMode: mode });
    persist({ themeMode: mode });
  },
  setFontSize: (size) => {
    set({ fontSize: size });
    persist({ fontSize: size });
  },
  setAutoLockMinutes: (minutes) => {
    set({ autoLockMinutes: minutes });
    persist({ autoLockMinutes: minutes });
  },
}));

function persist(patch: Partial<PersistShape>): void {
  const { themeMode, fontSize, autoLockMinutes } = settingsStore.getState();
  kvSet(KV_KEY, JSON.stringify({ themeMode, fontSize, autoLockMinutes, ...patch }));
}

/** 解析实际使用的明暗方案（跟随系统时由调用方传入系统值） */
export function resolveScheme(
  mode: ThemeMode,
  systemScheme: 'light' | 'dark' | null | undefined,
): 'light' | 'dark' {
  if (mode === 'system') return systemScheme ?? 'light';
  return mode;
}
