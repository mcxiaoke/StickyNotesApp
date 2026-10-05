// 便签色板单测：暗色变体可读性（WCAG AA）、浅色值回归（与桌面端一致的身份色）、统一取色入口
import { NOTE_COLOR_THEMES, NOTE_COLOR_THEMES_DARK, getNoteColorTheme, NOTE_COLORS } from '../src/data/theme';
import { contrastRatio } from '../src/services/contrast';

describe('getNoteColorTheme', () => {
  it('returns light themes unchanged (desktop-compatible identity colors)', () => {
    expect(getNoteColorTheme('yellow', false).background).toBe(NOTE_COLOR_THEMES.yellow.background);
    expect(getNoteColorTheme('yellow', false).background).toBe('#FFF7D1');
    expect(getNoteColorTheme('charcoal', false)).toEqual(NOTE_COLOR_THEMES.charcoal);
  });

  it('returns dark variants in dark mode and falls back for unknown colors', () => {
    expect(getNoteColorTheme('blue', true).background).toBe(NOTE_COLOR_THEMES_DARK.blue.background);
    expect(getNoteColorTheme('unknown-color', true)).toEqual(NOTE_COLOR_THEMES_DARK.yellow);
    expect(getNoteColorTheme('unknown-color', false)).toEqual(NOTE_COLOR_THEMES.yellow);
  });

  it('covers every note color in both palettes', () => {
    for (const key of NOTE_COLORS) {
      expect(NOTE_COLOR_THEMES[key]).toBeDefined();
      expect(NOTE_COLOR_THEMES_DARK[key]).toBeDefined();
    }
  });
});

describe('readability (WCAG AA)', () => {
  it('main text has >= 4.5:1 contrast on every card background (light & dark)', () => {
    for (const key of NOTE_COLORS) {
      for (const theme of [NOTE_COLOR_THEMES[key], NOTE_COLOR_THEMES_DARK[key]]) {
        expect(contrastRatio(theme.text, theme.background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('secondary text has >= 3:1 contrast on every card background', () => {
    for (const key of NOTE_COLORS) {
      for (const theme of [NOTE_COLOR_THEMES[key], NOTE_COLOR_THEMES_DARK[key]]) {
        expect(contrastRatio(theme.secondary, theme.background)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('dark card backgrounds are actually dark (luminance below M3 dark threshold)', () => {
    for (const key of NOTE_COLORS) {
      // 峰值亮度：yellow 暗底 #885818 也必须足够暗，白字才可读
      expect(contrastRatio('#FFFFFF', NOTE_COLOR_THEMES_DARK[key].background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
