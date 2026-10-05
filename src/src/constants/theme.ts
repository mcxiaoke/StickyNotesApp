// 应用外壳配色（导航栏、设置页等跟随平台视觉）；便签卡片配色见 data/theme.ts
import { Platform, type ViewStyle } from 'react-native';

export interface ShellPalette {
  background: string;
  surface: string;
  text: string;
  secondaryText: string;
  border: string;
  accent: string;
  /** 琥珀色 accent 底上的前景色（白字对比不足，统一用深字） */
  onAccent: string;
  /** 警告文字色（浅色下用深琥珀保证对比度） */
  warning: string;
  danger: string;
}

export const LIGHT_SHELL: ShellPalette = {
  background: '#F7F7F9',
  surface: '#FFFFFF',
  text: '#1C1C1E',
  secondaryText: '#6C6C70',
  border: '#E3E3E8',
  accent: '#E0A800',
  onAccent: '#1C1C1E',
  warning: '#8A6D00',
  danger: '#D64541',
};

export const DARK_SHELL: ShellPalette = {
  background: '#111114',
  surface: '#1E1E22',
  text: '#F2F2F4',
  secondaryText: '#A0A0A6',
  border: '#33333A',
  accent: '#E0A800',
  onAccent: '#111114',
  warning: '#E3B341',
  danger: '#E5635F',
};

export const IS_ANDROID = Platform.OS === 'android';

export function cardShadow(elevation: number): ViewStyle {
  if (Platform.OS === 'android') {
    return { elevation };
  }
  return {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: elevation,
  };
}
