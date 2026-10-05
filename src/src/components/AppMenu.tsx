// 通用底部操作菜单（平台弹层形态，跨端一致的简单实现）
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ShellPalette } from '../constants/theme';
import { useShellPalette } from '../hooks/use-shell';

export interface MenuAction {
  key: string;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

export function AppMenu({
  visible,
  onClose,
  actions,
  title,
}: {
  visible: boolean;
  onClose: () => void;
  actions: MenuAction[];
  title?: string;
}) {
  const p = useShellPalette();
  const styles = makeStyles(p);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {actions.map((action) => (
            <Pressable
              key={action.key}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              onPress={() => {
                onClose();
                action.onPress();
              }}
            >
              <Text style={[styles.itemText, action.destructive && styles.itemDestructive]}>
                {action.label}
              </Text>
            </Pressable>
          ))}
          <Pressable style={({ pressed }) => [styles.item, pressed && styles.itemPressed]} onPress={onClose}>
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (p: ShellPalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: '#00000066',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: p.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingBottom: 24,
      paddingHorizontal: 8,
      paddingTop: 8,
    },
    title: {
      color: p.secondaryText,
      fontSize: 13,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    item: {
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    itemPressed: {
      backgroundColor: p.border,
    },
    itemText: {
      color: p.text,
      fontSize: 16,
    },
    itemDestructive: {
      color: p.danger,
    },
    cancelText: {
      color: p.secondaryText,
      fontSize: 16,
      textAlign: 'center',
    },
  });
