// 搜索命中卡片：便签标题 + 1~3 行上下文（多关键词高亮）+ 行号/词频徽标
// 对齐桌面端搜索结果 ListBox 的卡片（NoteTitle / Lines / BadgeText）
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getNoteColorTheme, displayTitle } from '../data/theme';
import { relativeTime } from '../services/time';
import type { SearchHitCard as HitCard } from '../services/search';
import { useScheme, useShellPalette } from '../hooks/use-shell';
import { SPACING, RADII, FONT, LINE_HEIGHT } from '../constants/metrics';

export interface SearchHitCardProps {
  card: HitCard;
  onPress: (card: HitCard) => void;
}

export const SearchHitCard = memo(function SearchHitCard({ card, onPress }: SearchHitCardProps) {
  const dark = useScheme() === 'dark';
  const p = useShellPalette();
  const theme = getNoteColorTheme(card.note.color, dark);
  const hitStyle = { backgroundColor: p.accentContainer, color: p.onAccentContainer };

  const lineBadge =
    card.lineNumber === card.lastLineNumber
      ? `第 ${card.lineNumber} 行`
      : `第 ${card.lineNumber}-${card.lastLineNumber} 行`;
  const badgeText =
    card.totalMatches > 1 ? `${lineBadge} · 共 ${card.totalMatches} 处` : lineBadge;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.background, borderColor: theme.border },
        pressed && styles.pressed,
      ]}
      onPress={() => onPress(card)}
    >
      <View style={styles.titleRow}>
        <Text numberOfLines={1} style={[styles.title, { color: theme.text }]} ellipsizeMode="tail">
          {displayTitle(card.note.content)}
        </Text>
        <Text style={[styles.time, { color: theme.secondary }]}>
          {relativeTime(card.note.updatedAt)}
        </Text>
      </View>
      <View style={styles.snippet}>
        {card.snippetLines.map((line, li) => (
          <Text key={li} style={[styles.snippetLine, { color: theme.secondary }]}>
            {line.segments.map((seg, si) => (
              <Text key={si} style={seg.hit ? hitStyle : null}>
                {seg.text}
              </Text>
            ))}
          </Text>
        ))}
      </View>
      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <Text style={[styles.badgeText, { color: theme.secondary }]}>{badgeText}</Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: {
    borderRadius: RADII.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: SPACING.md - 2,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
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
  time: {
    fontSize: FONT.caption,
    lineHeight: LINE_HEIGHT.caption,
    marginLeft: SPACING.xs + 2,
  },
  snippet: {
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  snippetLine: {
    fontSize: FONT.label,
    lineHeight: LINE_HEIGHT.label + 1,
  },
  footer: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: SPACING.xs + 2,
  },
  badgeText: {
    fontSize: FONT.caption,
    lineHeight: LINE_HEIGHT.caption,
  },
});
