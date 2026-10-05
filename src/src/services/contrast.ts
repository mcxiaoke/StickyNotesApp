// WCAG 对比度工具 + 字体色反推（移植自 safenotes lib/utils/contrast.dart）
// 供便签色板（data/theme.ts）保证任意底色上的文字可读性，并可单测守恒

/** WCAG 相对亮度（sRGB 线性化） */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度：(L1+0.05)/(L2+0.05) */
export function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** 浅色模式的"深色"前景色（替代纯黑，M3 onSurface light） */
export const DARK_FOREGROUND = '#1C1B1F';
/** 暗色模式的"浅色"前景色（替代纯白，M3 onSurface dark） */
export const LIGHT_FOREGROUND = '#E6E1E5';

/**
 * 根据背景色亮度反推字体色。
 * 优先返回 M3 onSurface 色阶（深灰/浅灰），比纯黑纯白更柔和；
 * 中等亮度背景与 onSurface 对比不足 WCAG AA (4.5:1) 时，
 * 回退纯黑/纯白（选对比度更高者，数学上保证 ≥ 4.58:1）。
 * [isDark] 不传时按背景亮度判断（WCAG 阈值 0.179，即黑白对比度相等点）。
 */
export function getFontColorForBackground(background: string, isDark?: boolean): string {
  const dark = isDark ?? relativeLuminance(background) < 0.179;
  const softFg = dark ? LIGHT_FOREGROUND : DARK_FOREGROUND;
  if (contrastRatio(softFg, background) >= 4.5) {
    return softFg;
  }
  const blackContrast = contrastRatio('#000000', background);
  const whiteContrast = contrastRatio('#FFFFFF', background);
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF';
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`invalid hex color: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}
