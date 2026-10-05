// 已归档便签管理页：查看 / 恢复 / 彻底删除 / 清空回收站
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppMenu, type MenuAction } from '../components/AppMenu';
import type { ShellPalette } from '../constants/theme';
import { useShellPalette } from '../hooks/use-shell';
import type { Note } from '../data/note';
import { NOTE_COLOR_THEMES, displayTitle, previewText } from '../data/theme';
import { relativeTime } from '../services/time';
import { notesStore } from '../stores/notesStore';

export default function ArchiveScreen() {
  const p = useShellPalette();
  const styles = makeStyles(p);

  const notes = notesStore((s) => s.notes);
  const restoreAsync = notesStore((s) => s.restoreAsync);
  const purgeAsync = notesStore((s) => s.purgeAsync);
  const purgeAllDeletedAsync = notesStore((s) => s.purgeAllDeletedAsync);

  const archived = useMemo(() => notes.filter((n) => n.isDeleted), [notes]);
  const [menuNote, setMenuNote] = useState<Note | null>(null);

  const menuActions: MenuAction[] = useMemo(() => {
    if (!menuNote) return [];
    return [
      { key: 'restore', label: '恢复便签', onPress: () => void restoreAsync(menuNote.id) },
      {
        key: 'purge',
        label: '彻底删除',
        destructive: true,
        onPress: () => void purgeAsync(menuNote.id),
      },
    ];
  }, [menuNote, restoreAsync, purgeAsync]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.headerRow}>
        <Text style={styles.countText}>{archived.length} 条已归档</Text>
        {archived.length > 0 ? (
          <Pressable hitSlop={8} onPress={() => void purgeAllDeletedAsync()}>
            <Text style={styles.clearText}>清空</Text>
          </Pressable>
        ) : null}
      </View>

      <FlashList
        data={archived}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const theme = NOTE_COLOR_THEMES[item.color];
          return (
            <Pressable style={styles.row} onPress={() => setMenuNote(item)}>
              <View style={[styles.rowColor, { backgroundColor: theme.toolbar }]} />
              <View style={styles.rowBody}>
                <Text numberOfLines={1} style={styles.rowTitle}>
                  {displayTitle(item.content)}
                </Text>
                <Text numberOfLines={1} style={styles.rowPreview}>
                  {previewText(item.content)}
                </Text>
              </View>
              <Text style={styles.rowTime}>{relativeTime(item.updatedAt)}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🗑️</Text>
            <Text style={styles.emptyText}>回收站是空的</Text>
          </View>
        }
      />

      <AppMenu
        visible={menuNote !== null}
        onClose={() => setMenuNote(null)}
        actions={menuActions}
        title={menuNote ? '归档便签操作' : undefined}
      />
    </SafeAreaView>
  );
}

const makeStyles = (p: ShellPalette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: p.background,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    countText: {
      color: p.secondaryText,
      fontSize: 13,
    },
    clearText: {
      color: p.danger,
      fontSize: 14,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: p.surface,
      borderRadius: 10,
      marginHorizontal: 16,
      marginBottom: 8,
      padding: 12,
    },
    rowColor: {
      width: 10,
      height: 40,
      borderRadius: 5,
      marginRight: 12,
    },
    rowBody: {
      flex: 1,
    },
    rowTitle: {
      color: p.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowPreview: {
      color: p.secondaryText,
      fontSize: 13,
      marginTop: 2,
    },
    rowTime: {
      color: p.secondaryText,
      fontSize: 11,
      marginLeft: 8,
    },
    empty: {
      alignItems: 'center',
      paddingTop: 80,
    },
    emptyIcon: {
      fontSize: 44,
      marginBottom: 12,
    },
    emptyText: {
      color: p.secondaryText,
      fontSize: 14,
    },
  });
