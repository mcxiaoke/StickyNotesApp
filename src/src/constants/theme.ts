// 应用外壳语义色：由 Material 3 种子色在运行时生成（@material/material-color-utilities，纯 TS 计算，毫秒级）
// 唯一允许的非生成颜色：便签 7 色主题（data/theme.ts，用户自选便签色，与桌面端一致）
// 说明：库 0.3.0 的静态 scheme 未实现 surfaceContainer 系列角色（0.4.0 才有但 ESM 导出损坏），
// 此处按 M3 规范定义从 neutral 色调色板取对应 tone 补齐
import { themeFromSourceColor, hexFromArgb, type Scheme, type Theme } from '@material/material-color-utilities';
import { Platform, type ViewStyle } from 'react-native';

export const SEED_COLOR = 0x0064b5; // #0064B5

const theme: Theme = themeFromSourceColor(SEED_COLOR);
const neutral = theme.palettes.neutral;

export interface ShellPalette {
  background: string;
  /** 卡片/输入框表面 */
  surface: string;
  /** surface 上的按压态/嵌入块背景 */
  surfaceHigh: string;
  text: string;
  secondaryText: string;
  border: string;
  /** 主强调色（按钮、选中态、FAB） */
  accent: string;
  /** accent 底上的前景色 */
  onAccent: string;
  /** accent 的柔和容器底（选中 chips 背景、搜索高亮等） */
  accentContainer: string;
  /** accentContainer 底上的前景色 */
  onAccentContainer: string;
  /** 警告文字（M3 无 warning 角色，用 tertiary 作对比强调色） */
  warning: string;
  danger: string;
  /** danger 底上的前景色 */
  onError: string;
  /** 遮罩层（弹层背景压暗） */
  scrim: string;
}

function shell(scheme: Scheme, dark: boolean): ShellPalette {
  return {
    background: hexFromArgb(scheme.background),
    surface: hexFromArgb(neutral.tone(dark ? 12 : 100)),
    surfaceHigh: hexFromArgb(neutral.tone(dark ? 20 : 94)),
    text: hexFromArgb(scheme.onSurface),
    secondaryText: hexFromArgb(scheme.onSurfaceVariant),
    border: hexFromArgb(scheme.outlineVariant),
    accent: hexFromArgb(scheme.primary),
    onAccent: hexFromArgb(scheme.onPrimary),
    accentContainer: hexFromArgb(scheme.primaryContainer),
    onAccentContainer: hexFromArgb(scheme.onPrimaryContainer),
    warning: hexFromArgb(scheme.tertiary),
    danger: hexFromArgb(scheme.error),
    onError: hexFromArgb(scheme.onError),
    scrim: 'rgba(0,0,0,0.4)',
  };
}

export const LIGHT_SHELL: ShellPalette = shell(theme.schemes.light, false);
export const DARK_SHELL: ShellPalette = shell(theme.schemes.dark, true);

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
