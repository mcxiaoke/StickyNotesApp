// 经典 7 色主题色板（方案 §2.1，与桌面端色值严格一致，仅作用于便签卡片）
export const NOTE_COLORS = ['yellow', 'green', 'pink', 'purple', 'blue', 'gray', 'charcoal'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface NoteColorTheme {
  background: string;
  toolbar: string;
  text: string;
  border: string;
  accent: string;
  secondary: string;
}

export const NOTE_COLOR_THEMES: Record<NoteColor, NoteColorTheme> = {
  yellow: {
    background: '#FFF7D1',
    toolbar: '#FFEE9D',
    text: '#202020',
    border: '#E6D77D',
    accent: '#E0A800',
    secondary: '#6C6546',
  },
  green: {
    background: '#E4F9E0',
    toolbar: '#C8F2C2',
    text: '#202020',
    border: '#BCE5B6',
    accent: '#209E35',
    secondary: '#476A42',
  },
  pink: {
    background: '#FFE4EF',
    toolbar: '#FFC7DE',
    text: '#202020',
    border: '#F5BCCE',
    accent: '#DB3374',
    secondary: '#774457',
  },
  purple: {
    background: '#F2E6FF',
    toolbar: '#E4CCFF',
    text: '#202020',
    border: '#D5BAFA',
    accent: '#7F3CD8',
    secondary: '#594575',
  },
  blue: {
    background: '#E1F3FE',
    toolbar: '#C3E8FD',
    text: '#202020',
    border: '#B7DAF5',
    accent: '#1079D1',
    secondary: '#425C70',
  },
  gray: {
    background: '#F6F6F8',
    toolbar: '#E8E8EB',
    text: '#202020',
    border: '#DCDCE0',
    accent: '#636366',
    secondary: '#616166',
  },
  charcoal: {
    background: '#292929',
    toolbar: '#1E1E1E',
    text: '#F5F5F5',
    border: '#3D3D3D',
    accent: '#4CC2FF',
    secondary: '#A6A6A6',
  },
};

// 暗色变体（移植自 safenotes 的 Google Keep 暗色板：独立手调、更深更饱和，非公式生成）。
// 浅色色值是同步协议中的"颜色身份"（note.color key），永不变更；渲染时暗色模式查此表。
// 文字/次要用固定 M3 onSurface 色阶（保证对比度，见 services/contrast.ts 与 noteTheme 单测）
const DARK_NOTE_FG = {
  text: '#E6E1E5',
  secondary: '#BFBFBF',
  border: 'rgba(255,255,255,0.10)',
} as const;

export const NOTE_COLOR_THEMES_DARK: Record<NoteColor, NoteColorTheme> = {
  yellow: { background: '#885818', toolbar: '#6B450F', accent: '#E8B54A', ...DARK_NOTE_FG },
  green: { background: '#285840', toolbar: '#1E4534', accent: '#5CB876', ...DARK_NOTE_FG },
  pink: { background: '#683848', toolbar: '#522C39', accent: '#E36BA0', ...DARK_NOTE_FG },
  purple: { background: '#402858', toolbar: '#321F45', accent: '#A97FE0', ...DARK_NOTE_FG },
  blue: { background: '#284050', toolbar: '#1F323F', accent: '#5AA9E6', ...DARK_NOTE_FG },
  gray: { background: '#242426', toolbar: '#1B1B1D', accent: '#9E9EA4', ...DARK_NOTE_FG },
  charcoal: { background: '#292929', toolbar: '#1E1E1E', accent: '#4CC2FF', ...DARK_NOTE_FG },
};

/** 统一取色入口：浅色返回与桌面端一致的原定义，暗色返回 Google Keep 风格暗色变体 */
export function getNoteColorTheme(color: string, dark: boolean): NoteColorTheme {
  const key = noteColorFromString(color);
  return dark ? NOTE_COLOR_THEMES_DARK[key] : NOTE_COLOR_THEMES[key];
}

export function noteColorFromString(val: string): NoteColor {
  const lower = val.toLowerCase();
  return (NOTE_COLORS as readonly string[]).includes(lower) ? (lower as NoteColor) : 'yellow';
}

const EMPTY_TITLE = '（空白便签）';

export function displayTitle(content: string): string {
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (t) return t.length <= 40 ? t : t.slice(0, 40) + '...';
  }
  return EMPTY_TITLE;
}

export function previewText(content: string): string {
  const t = content.trim();
  return t === '' ? EMPTY_TITLE : t;
}
