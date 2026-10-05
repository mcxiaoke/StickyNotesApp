// 应用外壳配色（导航栏、设置页等跟随平台视觉）；便签卡片配色见 data/theme.ts
import { Platform, type ViewStyle } from 'react-native';

export interface ShellPalette {
  background: string;
  surface: string;
  text: string;
  secondaryText: string;
  border: string;
  accent: string;
  danger: string;
}

export const LIGHT_SHELL: ShellPalette = {
  background: '#F7F7F9',
  surface: '#FFFFFF',
  text: '#1C1C1E',
  secondaryText: '#6C6C70',
  border: '#E3E3E8',
  accent: '#E0A800',
  danger: '#D64541',
};

export const DARK_SHELL: ShellPalette = {
  background: '#111114',
  surface: '#1E1E22',
  text: '#F2F2F4',
  secondaryText: '#A0A0A6',
  border: '#33333A',
  accent: '#E0A800',
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
