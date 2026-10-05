// 应用设置 store：主题模式与正文字号（持久化到 SQLite kv）
import { create } from 'zustand';
import { kvGet, kvSet } from '../data/db';

export type ThemeMode = 'system' | 'light' | 'dark';
export const FONT_SIZES = [12, 14, 16, 18] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export const FONT_SIZE_LABELS: Record<FontSize, string> = {
  12: '小',
  14: '标准',
  16: '大',
  18: '超大',
};

interface AppSettings {
  themeMode: ThemeMode;
  fontSize: FontSize;
  hydrated: boolean;
  hydrate: () => void;
  setThemeMode: (mode: ThemeMode) => void;
  setFontSize: (size: FontSize) => void;
}

const KV_KEY = 'app.settings.v1';

interface PersistShape {
  themeMode: ThemeMode;
  fontSize: FontSize;
}

function loadPersisted(): PersistShape | null {
  const raw = kvGet(KV_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistShape;
  } catch {
    return null;
  }
}

export const settingsStore = create<AppSettings>((set) => ({
  themeMode: 'system',
  fontSize: 14,
  hydrated: false,
  hydrate: () => {
    const saved = loadPersisted();
    set({
      themeMode: saved?.themeMode ?? 'system',
      fontSize: saved?.fontSize ?? 14,
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
}));

function persist(patch: Partial<PersistShape>): void {
  const { themeMode, fontSize } = settingsStore.getState();
  kvSet(KV_KEY, JSON.stringify({ themeMode, fontSize, ...patch }));
}

/** 解析实际使用的明暗方案（跟随系统时由调用方传入系统值） */
export function resolveScheme(
  mode: ThemeMode,
  systemScheme: 'light' | 'dark' | null | undefined,
): 'light' | 'dark' {
  if (mode === 'system') return systemScheme ?? 'light';
  return mode;
}
