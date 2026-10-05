// 统一解析应用明暗方案与外壳配色：尊重设置页的主题模式（跟随系统/浅色/深色）
import { useColorScheme } from 'react-native';

import { DARK_SHELL, LIGHT_SHELL, type ShellPalette } from '../constants/theme';
import { settingsStore } from '../stores/settingsStore';

/** 当前生效的明暗方案（设置页覆盖 + 系统跟随） */
export function useScheme(): 'light' | 'dark' {
  const systemScheme = useColorScheme();
  const themeMode = settingsStore((s) => s.themeMode);
  if (themeMode !== 'system') return themeMode;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function useShellPalette(): ShellPalette {
  const scheme = useScheme();
  return scheme === 'dark' ? DARK_SHELL : LIGHT_SHELL;
}
