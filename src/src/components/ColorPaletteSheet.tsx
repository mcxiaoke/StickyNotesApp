// 7 色主题选择面板（底部弹出，圆形色块 + 选中对勾），色值与桌面端一致
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { NOTE_COLORS, NOTE_COLOR_THEMES, type NoteColor } from '../data/theme';
import { useShellPalette } from '../hooks/use-shell';

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
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: p.surface }]}>
          <View style={styles.row}>
            {NOTE_COLORS.map((color) => {
              const theme = NOTE_COLOR_THEMES[color];
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
                    <View style={[styles.checkMark, { backgroundColor: theme.accent }]} />
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
    backgroundColor: '#00000066',
    justifyContent: 'flex-end',
  },
    sheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 32,
      paddingTop: 20,
      paddingHorizontal: 12,
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
  checkMark: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
});
