// 便签主题颜色选择浮层菜单（顶部弹出，右上角悬浮卡片，多行大色块 + 选中对勾）
// 浅色值与桌面端一致，暗色用 Keep 风格变体，设计对齐桌面端 PopMenu
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NOTE_COLORS, getNoteColorTheme, type NoteColor } from '../data/theme';
import { useShellPalette, useScheme } from '../hooks/use-shell';
import { SPACING, RADII, FONT, LINE_HEIGHT, APPBAR_HEIGHT } from '../constants/metrics';

export function ColorPaletteMenu({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: NoteColor;
  onSelect: (color: NoteColor) => void;
  onClose: () => void;
}) {
  const p = useShellPalette();
  const dark = useScheme() === 'dark';
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        {/* 背景透明遮罩：点击空白区域收起 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        {/* 顶部悬浮卡片菜单：紧贴 AppBar 下方右上角 */}
        <View
          style={[
            styles.menuCard,
            {
              backgroundColor: p.surface,
              borderColor: p.border,
              top: insets.top + APPBAR_HEIGHT + SPACING.xs,
            },
          ]}
        >
          <Text style={[styles.menuTitle, { color: p.secondaryText }]}>便签主题色彩</Text>
          <View style={styles.paletteGrid}>
            {NOTE_COLORS.map((color) => {
              const theme = getNoteColorTheme(color, dark);
              const selected = color === current;
              return (
                <Pressable
                  key={color}
                  onPress={() => {
                    onSelect(color);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.colorCircle,
                    {
                      backgroundColor: theme.background,
                      borderColor: selected ? theme.accent : theme.border,
                    },
                    pressed && styles.colorCirclePressed,
                  ]}
                  hitSlop={4}
                  accessibilityRole="button"
                  accessibilityLabel={`便签颜色: ${color}`}
                >
                  {selected ? (
                    <Ionicons name="checkmark" size={22} color={theme.text} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// 保留 ColorPaletteSheet 别名，确保向前兼容
export const ColorPaletteSheet = ColorPaletteMenu;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  menuCard: {
    position: 'absolute',
    right: SPACING.md,
    borderRadius: RADII.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md - 2,
    paddingBottom: SPACING.md,
    minWidth: 236,
    maxWidth: 260,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  menuTitle: {
    fontSize: FONT.label,
    lineHeight: LINE_HEIGHT.label,
    fontWeight: '600',
    marginBottom: SPACING.xs + 2,
  },
  paletteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
  },
  colorCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorCirclePressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
});
