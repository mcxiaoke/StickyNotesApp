// 便签卡片：7 色主题作用于卡片本身（用户自选色，与桌面端一致），标题加粗提取 + 预览 + 置顶图钉 + 更多菜单（锚点弹出）
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { Note } from '../data/note';
import { getNoteColorTheme, displayTitle, previewText } from '../data/theme';
import { highlightSegments, type SearchSegment } from '../services/search';
import { relativeTime } from '../services/time';
import { useShellPalette, useScheme } from '../hooks/use-shell';
import { SPACING, RADII, FONT, LINE_HEIGHT } from '../constants/metrics';
import type { PopMenuAnchor } from './PopMenu';

export interface NoteCardProps {
  note: Note;
  query: string;
  onPress: (note: Note) => void;
  onMenu: (note: Note, anchor: PopMenuAnchor) => void;
}

export const NoteCard = memo(function NoteCard({ note, query, onPress, onMenu }: NoteCardProps) {
  const dark = useScheme() === 'dark';
  const theme = getNoteColorTheme(note.color, dark);
  const p = useShellPalette();
  const searchQuery = query.trim();

  const body = searchQuery ? highlightSegments(previewText(note.content), searchQuery) : null;
  const title: SearchSegment[] = searchQuery
    ? highlightSegments(displayTitle(note.content), searchQuery)
    : [{ text: displayTitle(note.content), hit: false }];

  const hitStyle = { backgroundColor: p.accentContainer, color: p.onAccentContainer };

  const card = (
    <Pressable
      style={({ pressed }) => [styles.card, { backgroundColor: theme.background, borderColor: theme.border }, pressed && styles.pressed]}
      onPress={() => onPress(note)}
    >
      <View style={styles.titleRow}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text }]} ellipsizeMode="tail">
          {title.map((seg, i) => (
            <Text key={i} style={seg.hit ? hitStyle : null}>
              {seg.text}
            </Text>
          ))}
        </Text>
        <View style={styles.titleActions}>
          {note.isPinnedInList ? (
            <MaterialCommunityIcons name="pin" size={16} color={theme.accent} style={styles.pin} />
          ) : null}
          <Pressable
            hitSlop={10}
            onPress={(e) => onMenu(note, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={theme.secondary} />
          </Pressable>
        </View>
      </View>
      <Text numberOfLines={4} style={[styles.preview, { color: theme.secondary }]}>
        {body
          ? body.map((seg, i) => (
              <Text key={i} style={seg.hit ? hitStyle : null}>
                {seg.text}
              </Text>
            ))
          : previewText(note.content)}
      </Text>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Text style={[styles.footerText, { color: theme.secondary }]}>{note.content.length} 字符</Text>
        <Text style={[styles.footerText, { color: theme.secondary }]}>{relativeTime(note.updatedAt)}</Text>
      </View>
    </Pressable>
  );

  return card;
});

const styles = StyleSheet.create({
  card: {
    borderRadius: RADII.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: SPACING.md - 2,
    paddingHorizontal: SPACING.md,
    // 列表不带 separator，卡片间距由自身 margin 提供（marginHorizontal 同时是双列瀑布流的列间距）
    marginBottom: SPACING.sm,
    marginHorizontal: SPACING.xs,
  },
  pressed: {
    opacity: 0.85,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    fontSize: FONT.bodyLg,
    lineHeight: LINE_HEIGHT.bodyLg,
    fontWeight: '700',
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: SPACING.xs + 2,
  },
  pin: {
    fontSize: FONT.caption + 1,
    marginRight: SPACING.xs,
  },
  preview: {
    fontSize: FONT.label,
    lineHeight: LINE_HEIGHT.label + 1,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SPACING.xs + 2,
  },
  footerText: {
    fontSize: FONT.caption,
    lineHeight: LINE_HEIGHT.caption,
  },
});
