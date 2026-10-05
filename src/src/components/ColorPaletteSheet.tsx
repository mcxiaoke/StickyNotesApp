// 7 色主题选择面板（底部弹出，圆形色块 + 选中对勾），浅色值与桌面端一致，暗色用 Keep 风格变体
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { NOTE_COLORS, getNoteColorTheme, type NoteColor } from '../data/theme';
import { useShellPalette, useScheme } from '../hooks/use-shell';
import { SPACING, RADII } from '../constants/metrics';

export function ColorPaletteSheet({
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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: p.scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: p.surface }]}>
          <View style={styles.row}>
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
                  style={[styles.circle, { backgroundColor: theme.background, borderColor: theme.border }]}
                  hitSlop={6}
                >
                  {selected ? (
                    <View style={[styles.innerDot, { backgroundColor: theme.accent }]} />
                  ) : (
                    <View style={[styles.innerDot, { backgroundColor: theme.toolbar }]} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: RADII.xl,
    borderTopRightRadius: RADII.xl,
    paddingBottom: SPACING.xxl + 8,
    paddingTop: SPACING.xl - 4,
    paddingHorizontal: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  circle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
});
