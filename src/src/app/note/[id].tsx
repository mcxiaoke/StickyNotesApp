// 便签编辑页：无干扰编辑 + 7 色即时切换 + 置顶/归档 + 500ms 防抖保存 + 进入后台刷盘
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppMenu, type MenuAction } from '../../components/AppMenu';
import { ColorPaletteSheet } from '../../components/ColorPaletteSheet';
import { NOTE_COLOR_THEMES, type NoteColor } from '../../data/theme';
import { AutoSaveCoordinator } from '../../services/autoSave';
import { notesStore } from '../../stores/notesStore';
import { settingsStore } from '../../stores/settingsStore';
import { syncStore } from '../../stores/syncStore';

export default function NoteEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const fontSize = settingsStore((s) => s.fontSize);
  const syncStatus = syncStore((s) => s.status);

  const note = notesStore((s) => s.notes.find((n) => n.id === id));
  const [draft, setDraft] = useState<string | null>(null);
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  const content = draft ?? note?.content ?? '';
  const theme = NOTE_COLOR_THEMES[note?.color ?? 'yellow'];

  const autoSave = useMemo(
    () =>
      new AutoSaveCoordinator(async (noteId, noteContent) => {
        await notesStore.getState().saveContentAsync(noteId, noteContent);
      }),
    [],
  );

  // 新建分支：/note/new 进入即创建空便签并替换路由为真实 id
  useEffect(() => {
    if (id !== 'new') return;
    let cancelled = false;
    void (async () => {
      const created = await notesStore.getState().createAsync('', 'yellow');
      if (!cancelled) router.replace(`/note/${created.id}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  // 返回或进入后台：无条件刷盘
  useEffect(() => {
    const flush = () => void autoSave.flush();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => {
      flush();
      sub.remove();
    };
  }, [autoSave]);

  const menuActions: MenuAction[] = useMemo(
    () => [
      {
        key: 'archive',
        label: '归档便签',
        destructive: true,
        onPress: () => {
          if (!id || id === 'new') return;
          void notesStore.getState().archiveAsync(id).then(() => router.back());
        },
      },
      {
        key: 'discard',
        label: '放弃更改',
        onPress: () => {
          setDraft(null);
          router.back();
        },
      },
    ],
    [id, router],
  );

  const handleBack = () => {
    void autoSave.flush().then(() => {
      // 空便签返回即丢弃（本地删除，不再进入同步流）
      if (note && note.content === '' && (draft ?? '') === '') {
        void notesStore.getState().purgeAsync(note.id);
      }
      router.back();
    });
  };

  if (id === 'new' || !note) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: NOTE_COLOR_THEMES.yellow.background }]}>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const syncLabel =
    syncStatus === 'syncing' ? '同步中...' : syncStatus === 'success' ? '已同步' : syncStatus === 'error' ? '未同步' : '';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* 顶部窄工具栏（高度与 Stack AppBar 统一） */}
        <View style={[styles.toolbar, { backgroundColor: theme.toolbar, borderBottomColor: theme.border }]}>
          <Pressable style={styles.toolbarSlot} onPress={handleBack}>
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <View style={styles.toolbarRight}>
            <Pressable
              style={styles.toolbarSlot}
              onPress={() => void notesStore.getState().togglePinAsync(note.id)}
            >
              <Ionicons
                name="pin"
                size={22}
                color={note.isPinnedInList ? theme.text : theme.secondary}
              />
            </Pressable>
            <Pressable style={styles.toolbarSlot} onPress={() => setPaletteVisible(true)}>
              <Ionicons name="color-palette-outline" size={22} color={theme.text} />
            </Pressable>
            <Pressable style={styles.toolbarSlot} onPress={() => setMenuVisible(true)}>
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.text} />
            </Pressable>
          </View>
        </View>

        {/* 全屏编辑区 */}
        <TextInput
          style={[styles.editor, { color: theme.text, fontSize }]}
          multiline
          value={content}
          placeholder="记录点什么..."
          placeholderTextColor={theme.secondary}
          onChangeText={(text) => {
            setDraft(text);
            autoSave.schedule(note.id, text);
          }}
          textAlignVertical="top"
          autoFocus={note.content === ''}
        />

        {/* 底部状态栏 */}
        <View style={[styles.statusBar, { borderTopColor: theme.border }]}>
          <Text style={[styles.statusText, { color: theme.secondary }]}>{content.length} 字符</Text>
          <Text style={[styles.statusText, { color: theme.secondary }]}>{syncLabel}</Text>
        </View>
      </KeyboardAvoidingView>

      <ColorPaletteSheet
        visible={paletteVisible}
        current={note.color as NoteColor}
        onSelect={(color) => void notesStore.getState().setColorAsync(note.id, color)}
        onClose={() => setPaletteVisible(false)}
      />
      <AppMenu visible={menuVisible} onClose={() => setMenuVisible(false)} actions={menuActions} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    // 与 Stack AppBar（56dp）保持统一高度
    height: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarSlot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  editor: {
    flex: 1,
    padding: 16,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statusText: {
    fontSize: 12,
  },
});
