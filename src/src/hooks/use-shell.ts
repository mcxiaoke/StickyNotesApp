// 统一解析应用外壳配色：尊重设置页的主题模式（跟随系统/浅色/深色）
import { useColorScheme } from 'react-native';

import { DARK_SHELL, LIGHT_SHELL, type ShellPalette } from '../constants/theme';
import { settingsStore } from '../stores/settingsStore';

export function useShellPalette(): ShellPalette {
  const systemScheme = useColorScheme();
  const themeMode = settingsStore((s) => s.themeMode);
  const scheme = themeMode === 'system' ? (systemScheme ?? 'light') : themeMode;
  return scheme === 'dark' ? DARK_SHELL : LIGHT_SHELL;
}
