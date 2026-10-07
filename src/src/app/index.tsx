// 便签列表主界面：搜索 + 分类过滤 Chips + 双列瀑布流卡片 + FAB + 下拉刷新同步
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { NoteCard } from '../components/NoteCard';
import { PopMenu } from '../components/PopMenu';
import type { MenuAction } from '../components/AppMenu';
import type { PopMenuAnchor } from '../components/PopMenu';
import { SearchBar } from '../components/SearchBar';
import { SearchHitCard } from '../components/SearchHitCard';
import { SyncDot } from '../components/SyncDot';
import { cardShadow, type ShellPalette } from '../constants/theme';
import { SPACING, RADII, FONT, LINE_HEIGHT, TOUCH_TARGET, APPBAR_HEIGHT, FAB_SIZE } from '../constants/metrics';
import type { Note } from '../data/note';
import { searchNotes } from '../services/search';
import { useSearchInput } from '../hooks/use-search-input';
import { notesStore } from '../stores/notesStore';
import { syncStore } from '../stores/syncStore';
import { useShellPalette } from '../hooks/use-shell';

type FilterMode = 'all' | 'pinned';

/** 下拉刷新的转圈上限：只决定转圈何时收起，不中断同步（原先的 1200ms 会在慢网下过早收起） */
const MANUAL_REFRESH_SPINNER_MAX_MS = 15_000;

export default function NotesListScreen() {
  const router = useRouter();
  const p = useShellPalette();
  // 配色只有明/暗两套常量，按引用记忆化即可避免每次渲染重建整套 StyleSheet
  const styles = useMemo(() => makeStyles(p), [p]);

  const notes = notesStore((s) => s.notes);
  const refreshAsync = notesStore((s) => s.refreshAsync);
  const archiveAsync = notesStore((s) => s.archiveAsync);
  const togglePinAsync = notesStore((s) => s.togglePinAsync);
  const syncStatus = syncStore((s) => s.status);
  const syncInFlight = syncStore((s) => s.inFlight);

  const { query, searchQuery, updateQuery } = useSearchInput();
  const isSearching = searchQuery.trim() !== '';
  const [filter, setFilter] = useState<FilterMode>('all');
  const [menuTarget, setMenuTarget] = useState<{ note: Note; anchor: PopMenuAnchor } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // 非搜索态列表：未删除 + 分类过滤 + 置顶优先/时间降序（搜索态的排序由 searchNotes 决定）
  const visibleNotes = useMemo(() => {
    const active = notes.filter((n) => !n.isDeleted);
    const filtered = filter === 'pinned' ? active.filter((n) => n.isPinnedInList) : active;
    return [...filtered].sort((a, b) => {
      if (a.isPinnedInList !== b.isPinnedInList) return a.isPinnedInList ? -1 : 1;
      return a.updatedAt >= b.updatedAt ? -1 : 1;
    });
  }, [notes, filter]);

  // 搜索态：卡片化结果（内部只搜未删除便签，排序为质量优先 → 时间降序，不考虑置顶）
  const searchResults = useMemo(
    () => (isSearching ? searchNotes(notes, searchQuery) : []),
    [notes, searchQuery, isSearching],
  );
  const matchedNoteCount = useMemo(() => {
    const ids = new Set<string>();
    for (const hit of searchResults) ids.add(hit.note.id);
    return ids.size;
  }, [searchResults]);

  const allCount = useMemo(() => notes.filter((n) => !n.isDeleted).length, [notes]);
  const pinnedCount = useMemo(() => notes.filter((n) => !n.isDeleted && n.isPinnedInList).length, [notes]);

  const manualRefresh = useCallback(async () => {
    setRefreshing(true);
    // 不 await：先让本轮同步尽早开始，与下面的本地刷新并行
    const round = syncStore.getState().runNow();
    try {
      // 第一段：读本地库立即呈现已有数据（毫秒级），不让转圈被网络等待拖住
      await refreshAsync();
      // 第二段：等本轮结束。这里的上限只决定转圈何时收起，不中断同步；
      // 同步完成后的列表刷新由 setAfterSync 收口保证，超时也不会丢数据。
      await Promise.race([round, new Promise((r) => setTimeout(r, MANUAL_REFRESH_SPINNER_MAX_MS))]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshAsync]);

  // 稳定引用：NoteCard 有 memo，回调每次渲染重建会让 memo 失效，列表卡顿
  const openNote = useCallback((note: Note) => router.push(`/note/${note.id}`), [router]);
  const openHit = useCallback(
    (card: (typeof searchResults)[number]) => router.push(`/note/${card.note.id}`),
    [router],
  );
  const openCardMenu = useCallback((note: Note, anchor: PopMenuAnchor) => setMenuTarget({ note, anchor }), []);

  const menuActions: MenuAction[] = useMemo(() => {
    const note = menuTarget?.note;
    if (!note) return [];
    return [
      {
        key: 'pin',
        label: note.isPinnedInList ? '取消置顶' : '置顶',
        onPress: () => void togglePinAsync(note.id),
      },
      {
        key: 'archive',
        label: '归档',
        destructive: true,
        onPress: () => void archiveAsync(note.id),
      },
    ];
  }, [menuTarget, togglePinAsync, archiveAsync]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* 顶部导航栏 */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.logo, { backgroundColor: p.accentContainer }]}>
            <Text style={[styles.logoText, { color: p.onAccentContainer }]}>S</Text>
          </View>
          <Text style={styles.headerTitle}>便签</Text>
        </View>
        <View style={styles.headerActions}>
          <View style={styles.headerSlot}>
            <SyncDot status={syncStatus} inFlight={syncInFlight} />
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
        <SearchBar value={query} placeholder="搜索便签内容..." onChangeText={updateQuery} />
      </View>

      {/* 搜索态显示结果计数；非搜索态显示分类过滤 Chips */}
      {isSearching ? (
        searchResults.length > 0 ? (
          <View style={styles.chipsRow}>
            <Text style={[styles.statusText, { color: p.secondaryText }]}>
              {`找到 ${searchResults.length} 条结果（来自 ${matchedNoteCount} 张便签）`}
            </Text>
          </View>
        ) : null
      ) : (
        <View style={styles.chipsRow}>
          <Chip label={`全部 (${allCount})`} active={filter === 'all'} onPress={() => setFilter('all')} p={p} />
          <Chip label={`已置顶 (${pinnedCount})`} active={filter === 'pinned'} onPress={() => setFilter('pinned')} p={p} />
        </View>
      )}

      {/* 搜索结果列表：卡片化命中项（单列） */}
      {isSearching ? (
        <FlashList
          data={searchResults}
          keyExtractor={(item, index) => `${item.note.id}-${item.lineNumber}-${index}`}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <SearchHitCard card={item} onPress={openHit} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyText}>没有匹配的便签</Text>
            </View>
          }
        />
      ) : (
        /* 便签卡片流 */
        <FlashList
          data={visibleNotes}
          masonry
          numColumns={2}
          contentContainerStyle={styles.listContent}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <NoteCard note={item} query="" onPress={openNote} onMenu={openCardMenu} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🗒️</Text>
              <Text style={styles.emptyText}>还没有便签，点击右下角 + 新建</Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void manualRefresh()} tintColor={p.secondaryText} />
          }
        />
      )}

      {/* 浮动操作按钮 */}
      <Pressable
        style={({ pressed }) => [styles.fab, cardShadow(6), pressed && styles.fabPressed]}
        onPress={() => router.push('/note/new')}
      >
        <Ionicons name="add" size={30} color={p.onAccent} />
      </Pressable>

      <PopMenu
        anchor={menuTarget?.anchor ?? null}
        actions={menuActions}
        onClose={() => setMenuTarget(null)}
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
        {
          backgroundColor: active ? p.accentContainer : p.surface,
          borderColor: active ? p.accentContainer : p.border,
        },
      ]}
    >
      <Text style={{ color: active ? p.onAccentContainer : p.text, fontSize: FONT.label }}>
        {label}
      </Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    borderRadius: RADII.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SPACING.lg - 2,
    paddingVertical: SPACING.sm - 2,
    marginRight: SPACING.sm,
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
      paddingHorizontal: SPACING.sm,
      height: APPBAR_HEIGHT,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: SPACING.sm,
    },
    logo: {
      width: 28,
      height: 28,
      borderRadius: RADII.sm,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: SPACING.sm,
    },
    logoText: {
      fontWeight: '900',
      fontSize: FONT.bodyLg,
    },
    headerTitle: {
      color: p.text,
      fontSize: FONT.headline,
      fontWeight: '700',
      lineHeight: LINE_HEIGHT.headline,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.xs,
    },
    headerSlot: {
      width: TOUCH_TARGET,
      height: TOUCH_TARGET,
      borderRadius: TOUCH_TARGET / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerSlotPressed: {
      backgroundColor: p.surfaceHigh,
    },
    searchWrap: {
      paddingHorizontal: SPACING.lg,
      paddingBottom: SPACING.sm,
    },
    statusText: {
      fontSize: FONT.label,
      lineHeight: LINE_HEIGHT.label,
    },
    chipsRow: {
      flexDirection: 'row',
      paddingHorizontal: SPACING.lg,
      paddingBottom: SPACING.md - 2,
    },
    listContent: {
      paddingHorizontal: SPACING.lg,
      paddingBottom: SPACING.listBottom,
    },
    empty: {
      alignItems: 'center',
      paddingTop: SPACING.emptyTop,
    },
    emptyIcon: {
      fontSize: 44,
      marginBottom: SPACING.md,
    },
    emptyText: {
      color: p.secondaryText,
      fontSize: FONT.body,
      lineHeight: LINE_HEIGHT.body,
    },
    fab: {
      position: 'absolute',
      right: SPACING.xl - 4,
      bottom: SPACING.xxl - 4,
      width: FAB_SIZE,
      height: FAB_SIZE,
      borderRadius: RADII.lg,
      backgroundColor: p.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fabPressed: {
      opacity: 0.85,
    },
  });
