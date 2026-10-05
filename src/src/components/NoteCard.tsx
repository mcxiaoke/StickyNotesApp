// 便签卡片：7 色主题作用于卡片本身，标题加粗提取 + 预览 + 置顶图钉 + 更多菜单 + 左滑归档
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import type { Note } from '../data/note';
import { NOTE_COLOR_THEMES, displayTitle, previewText } from '../data/theme';
import { highlightSegments, type SearchSegment } from '../services/search';
import { relativeTime } from '../services/time';

export interface NoteCardProps {
  note: Note;
  query: string;
  onPress: (note: Note) => void;
  onMenu: (note: Note) => void;
  onSwipeArchive?: (note: Note) => void;
}

export const NoteCard = memo(function NoteCard({ note, query, onPress, onMenu, onSwipeArchive }: NoteCardProps) {
  const theme = NOTE_COLOR_THEMES[note.color];
  const searchQuery = query.trim();

  const body = searchQuery ? highlightSegments(previewText(note.content), searchQuery) : null;
  const title: SearchSegment[] = searchQuery
    ? highlightSegments(displayTitle(note.content), searchQuery)
    : [{ text: displayTitle(note.content), hit: false }];

  const card = (
    <Pressable
      style={({ pressed }) => [styles.card, { backgroundColor: theme.background, borderColor: theme.border }, pressed && styles.pressed]}
      onPress={() => onPress(note)}
    >
      <View style={styles.titleRow}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text }]} ellipsizeMode="tail">
          {title.map((seg, i) => (
            <Text key={i} style={seg.hit ? styles.hit : null}>
              {seg.text}
            </Text>
          ))}
        </Text>
        <View style={styles.titleActions}>
          {note.isPinnedInList ? (
            <Ionicons name="pin" size={15} color={theme.accent} style={styles.pin} />
          ) : null}
          <Pressable hitSlop={10} onPress={() => onMenu(note)}>
            <Ionicons name="ellipsis-horizontal" size={18} color={theme.secondary} />
          </Pressable>
        </View>
      </View>
      <Text numberOfLines={4} style={[styles.preview, { color: theme.secondary }]}>
        {body
          ? body.map((seg, i) => (
              <Text key={i} style={seg.hit ? styles.hit : null}>
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

  if (!onSwipeArchive) return card;

  return (
    <ReanimatedSwipeable
      containerStyle={styles.swipeContainer}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <Pressable style={styles.swipeAction} onPress={() => onSwipeArchive(note)}>
          <Text style={styles.swipeActionText}>归档</Text>
        </Pressable>
      )}
    >
      {card}
    </ReanimatedSwipeable>
  );
});

const styles = StyleSheet.create({
  swipeContainer: {
    marginBottom: 8,
    marginHorizontal: 4,
  },
  card: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 12,
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
    fontSize: 15,
    fontWeight: '700',
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 6,
  },
  pin: {
    fontSize: 12,
    marginRight: 4,
  },
  preview: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 8,
  },
  hit: {
    backgroundColor: '#FFE27A',
    color: '#202020',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
  },
  footerText: {
    fontSize: 11,
  },
  swipeAction: {
    width: 72,
    marginLeft: 8,
    borderRadius: 10,
    backgroundColor: '#D64541',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeActionText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
});
