// 便签列表主界面：搜索 + 分类过滤 Chips + 双列瀑布流卡片 + FAB + 下拉刷新同步
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { NoteCard } from '../components/NoteCard';
import { AppMenu, type MenuAction } from '../components/AppMenu';
import { SyncDot } from '../components/SyncDot';
import { cardShadow, type ShellPalette } from '../constants/theme';
import { useShellPalette } from '../hooks/use-shell';
import type { Note } from '../data/note';
import { filterNotes } from '../services/search';
import { notesStore } from '../stores/notesStore';
import { syncStore } from '../stores/syncStore';

type FilterMode = 'all' | 'pinned';

export default function NotesListScreen() {
  const router = useRouter();
  const p = useShellPalette();
  const styles = makeStyles(p);

  const notes = notesStore((s) => s.notes);
  const refreshAsync = notesStore((s) => s.refreshAsync);
  const archiveAsync = notesStore((s) => s.archiveAsync);
  const togglePinAsync = notesStore((s) => s.togglePinAsync);
  const syncStatus = syncStore((s) => s.status);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [menuNote, setMenuNote] = useState<Note | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const visibleNotes = useMemo(() => {
    const active = notes.filter((n) => !n.isDeleted);
    const filtered = filter === 'pinned' ? active.filter((n) => n.isPinnedInList) : active;
    const sorted = [...filtered].sort((a, b) => {
      if (a.isPinnedInList !== b.isPinnedInList) return a.isPinnedInList ? -1 : 1;
      return a.updatedAt >= b.updatedAt ? -1 : 1;
    });
    return filterNotes(sorted, query);
  }, [notes, filter, query]);

  const allCount = useMemo(() => notes.filter((n) => !n.isDeleted).length, [notes]);
  const pinnedCount = useMemo(() => notes.filter((n) => !n.isDeleted && n.isPinnedInList).length, [notes]);

  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    const started = syncStore.getState().runNow();
    await Promise.race([started, new Promise((r) => setTimeout(r, 1200))]);
    await refreshAsync();
    setRefreshing(false);
  }, [refreshAsync]);

  const menuActions: MenuAction[] = useMemo(() => {
    if (!menuNote) return [];
    return [
      {
        key: 'pin',
        label: menuNote.isPinnedInList ? '取消置顶' : '置顶',
        onPress: () => void togglePinAsync(menuNote.id),
      },
      {
        key: 'archive',
        label: '归档',
        destructive: true,
        onPress: () => void archiveAsync(menuNote.id),
      },
    ];
  }, [menuNote, togglePinAsync, archiveAsync]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 顶部导航栏 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>S</Text>
          </View>
          <Text style={styles.headerTitle}>便签</Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.headerSlot}>
            <SyncDot status={syncStatus} />
          </View>
          <Pressable
            style={({ pressed }) => [styles.headerSlot, pressed && styles.headerSlotPressed]}
            onPress={() => router.push('/archive')}
          >
            <Ionicons name="archive-outline" size={22} color={p.text} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.headerSlot, pressed && styles.headerSlotPressed]}
            onPress={() => router.push('/settings')}
          >
            <Ionicons name="settings-outline" size={22} color={p.text} />
          </Pressable>
        </View>
      </View>

      {/* 快捷搜索框 */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="搜索便签内容..."
          placeholderTextColor={p.secondaryText}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
      </View>

      {/* 分类过滤 Chips */}
      <View style={styles.chipsRow}>
        <Chip label={`全部 (${allCount})`} active={filter === 'all'} onPress={() => setFilter('all')} p={p} />
        <Chip label={`已置顶 (${pinnedCount})`} active={filter === 'pinned'} onPress={() => setFilter('pinned')} p={p} />
      </View>

      {/* 便签卡片流 */}
      <FlashList
        data={visibleNotes}
        masonry
        numColumns={2}
        contentContainerStyle={styles.listContent}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NoteCard
            note={item}
            query={query}
            onPress={(note) => router.push(`/note/${note.id}`)}
            onMenu={setMenuNote}
            onSwipeArchive={(note) => void archiveAsync(note.id)}
          />
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🗒️</Text>
            <Text style={styles.emptyText}>{query ? '没有匹配的便签' : '还没有便签，点击右下角 + 新建'}</Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void manualRefresh()} tintColor={p.secondaryText} />
        }
      />

      {/* 浮动操作按钮 */}
      <Pressable
        style={({ pressed }) => [styles.fab, cardShadow(6), pressed && styles.fabPressed]}
        onPress={() => router.push('/note/new')}
      >
        <Ionicons name="add" size={30} color={p.onAccent} />
      </Pressable>

      <AppMenu
        visible={menuNote !== null}
        onClose={() => setMenuNote(null)}
        actions={menuActions}
        title={menuNote ? '便签操作' : undefined}
      />
    </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  onPress,
  p,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  p: ShellPalette;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        chipStyles.chip,
        { backgroundColor: active ? p.accent : p.surface, borderColor: active ? p.accent : p.border },
      ]}
    >
      <Text style={{ color: active ? p.onAccent : p.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
  },
});

const makeStyles = (p: ShellPalette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: p.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 8,
      // 与 Stack AppBar（56dp）保持统一高度
      height: 56,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 8,
    },
    logo: {
      width: 28,
      height: 28,
      borderRadius: 7,
      backgroundColor: '#FFEE9D',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    logoText: {
      color: '#6C6546',
      fontWeight: '900',
      fontSize: 15,
    },
    headerTitle: {
      color: p.text,
      fontSize: 20,
      fontWeight: '700',
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    headerSlot: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerSlotPressed: {
      backgroundColor: p.border,
    },
    searchWrap: {
      paddingHorizontal: 16,
      paddingBottom: 8,
    },
    searchInput: {
      backgroundColor: p.surface,
      borderColor: p.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 9,
      color: p.text,
      fontSize: 15,
    },
    chipsRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingBottom: 10,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingBottom: 96,
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
    fab: {
      position: 'absolute',
      right: 20,
      bottom: 28,
      width: 56,
      height: 56,
      borderRadius: 16,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fabPressed: {
      opacity: 0.85,
    },
  });
