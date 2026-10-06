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
import { SPACING, RADII, FONT, LINE_HEIGHT, TOUCH_TARGET, APPBAR_HEIGHT, FAB_SIZE } from '../constants/metrics';
import type { Note } from '../data/note';
import { filterNotes } from '../services/search';
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
    searchInput: {
      backgroundColor: p.surface,
      borderColor: p.border,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: RADII.md,
      paddingHorizontal: SPACING.lg - 2,
      paddingVertical: SPACING.sm,
      color: p.text,
      fontSize: FONT.bodyLg,
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
