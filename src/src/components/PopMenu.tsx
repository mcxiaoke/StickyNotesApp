// 锚点弹出菜单：在触发点附近弹出的轻量菜单（区别于 AppMenu 的底部大 sheet）
import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { MenuAction } from './AppMenu';
import type { ShellPalette } from '../constants/theme';
import { useShellPalette } from '../hooks/use-shell';
import { SPACING, RADII, FONT, LINE_HEIGHT } from '../constants/metrics';

export interface PopMenuAnchor {
  x: number;
  y: number;
}

/** 菜单尺寸用于定位计算，条目数变化时高度随之变化 */
const MENU_WIDTH = 176;
const ITEM_HEIGHT = 44;
const EDGE_MARGIN = SPACING.md;
const POP_GAP = SPACING.xs;

export function PopMenu({
  anchor,
  actions,
  onClose,
}: {
  anchor: PopMenuAnchor | null;
  actions: MenuAction[];
  onClose: () => void;
}) {
  const p = useShellPalette();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(p), [p]);

  const position = useMemo(() => {
    if (!anchor) return null;
    const height = actions.length * ITEM_HEIGHT + SPACING.xs * 2;
    // 右边缘对齐触发点（三点按钮在卡片右侧），越界时收回来
    const left = Math.min(
      Math.max(anchor.x - MENU_WIDTH, EDGE_MARGIN),
      screenW - EDGE_MARGIN - MENU_WIDTH,
    );
    const below = anchor.y + POP_GAP + height + EDGE_MARGIN <= screenH;
    const top = below
      ? anchor.y + POP_GAP
      : Math.max(anchor.y - POP_GAP - height, EDGE_MARGIN);
    return { top, left };
  }, [anchor, actions.length, screenW, screenH]);

  return (
    <Modal visible={anchor !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        {position ? (
          <View style={[styles.menu, position]}>
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
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const makeStyles = (p: ShellPalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: p.scrim,
    },
    menu: {
      position: 'absolute',
      width: MENU_WIDTH,
      backgroundColor: p.surface,
      borderRadius: RADII.md,
      paddingVertical: SPACING.xs,
      // 弹层浮在内容上，用阴影与背景区分
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    item: {
      height: ITEM_HEIGHT,
      justifyContent: 'center',
      paddingHorizontal: SPACING.lg,
      borderRadius: RADII.sm,
    },
    itemPressed: {
      backgroundColor: p.surfaceHigh,
    },
    itemText: {
      color: p.text,
      fontSize: FONT.body,
      lineHeight: LINE_HEIGHT.body,
    },
    itemDestructive: {
      color: p.danger,
    },
  });
