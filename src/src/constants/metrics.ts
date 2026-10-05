// 布局度量常量：间距、圆角、字号、行高、点击区域——UI 一律引用这些常量，不写魔法数字
// 间距基于 4dp 网格；字号映射常用层级（caption→display）

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  /** 空状态图标距顶部 */
  emptyTop: 80,
  /** 列表底部留白（FAB 高度 + 安全距离） */
  listBottom: 96,
} as const;

export const RADII = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
} as const;

export const FONT = {
  caption: 11,
  small: 12,
  label: 13,
  body: 14,
  bodyLg: 15,
  title: 17,
  headline: 20,
  display: 22,
} as const;

export const LINE_HEIGHT = {
  caption: 16,
  small: 18,
  label: 18,
  body: 20,
  bodyLg: 21,
  title: 24,
  headline: 28,
  display: 30,
} as const;

/** 图标按钮的统一点击区域（Material 建议 ≥48dp，含间距后实际可达） */
export const TOUCH_TARGET = 40;

/** 顶栏高度（与 Stack AppBar 的 Android 默认值一致） */
export const APPBAR_HEIGHT = 56;

/** FAB 尺寸 */
export const FAB_SIZE = 56;
