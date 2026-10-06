// 便签编辑页：无干扰编辑 + 7 色即时切换 + 置顶/归档 + 500ms 防抖保存 + 进入后台刷盘
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppMenu, type MenuAction } from '../../components/AppMenu';
import { ColorPaletteSheet } from '../../components/ColorPaletteSheet';
import { getNoteColorTheme, type NoteColor } from '../../data/theme';
import { AutoSaveCoordinator } from '../../services/autoSave';
import { notesStore } from '../../stores/notesStore';
import { settingsStore } from '../../stores/settingsStore';
import { syncStore } from '../../stores/syncStore';
import { useScheme } from '../../hooks/use-shell';
import { SPACING, FONT, LINE_HEIGHT, TOUCH_TARGET, APPBAR_HEIGHT } from '../../constants/metrics';

export default function NoteEditorScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const fontSize = settingsStore((s) => s.fontSize);
  const syncStatus = syncStore((s) => s.status);

  const note = notesStore((s) => s.notes.find((n) => n.id === id));
  const [draft, setDraft] = useState<string | null>(null);
  const [paletteVisible, setPaletteVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(id === 'new' || (note ? note.content === '' : false));

  const inputRef = useRef<TextInput>(null);

  const content = draft ?? note?.content ?? '';
  const dark = useScheme() === 'dark';
  const theme = getNoteColorTheme(note?.color ?? 'yellow', dark);

  const autoSave = useMemo(
    () =>
      new AutoSaveCoordinator(async (noteId, noteContent) => {
        await notesStore.getState().saveContentAsync(noteId, noteContent);
      }),
    [],
  );

  // 键盘收起时自动切回只读/浏览模式，防止后续滑动误触
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      setIsEditing(false);
    });
    return () => sub.remove();
  }, []);

  const startEditing = () => {
    if (!isEditing) {
      setIsEditing(true);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  };

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

  // 「放弃更改」已移除：500ms 防抖早已把内容落库，该操作既不回滚也不清除，语义名不副实。
  // 返回键本就是「保存并退出」，统一语义后菜单只保留归档。
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
    ],
    [id, router],
  );

  const handleBack = () => {
    if (!note) {
      router.back();
      return;
    }
    const noteId = note.id;
    void autoSave.flush().then(() => {
      // flush 已把 draft 落库，因此以 store 里的最新值判定，避免渲染闭包读到过期内容
      const latest = notesStore.getState().notes.find((n) => n.id === noteId);
      // 空便签返回即丢弃（本地删除，不再进入同步流）
      if (latest && latest.content === '') {
        void notesStore.getState().purgeAsync(noteId);
      }
      router.back();
    });
  };

  if (id === 'new' || !note) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: getNoteColorTheme('yellow', dark).background }]}>
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
          <Pressable style={styles.toolbarSlot} onPress={handleBack} hitSlop={6} accessibilityLabel="返回">
            <Ionicons name="chevron-back" size={22} color={theme.text} />
          </Pressable>
          <View style={styles.toolbarRight}>
            {/* 置顶切换：斜向经典按钉（置顶实心，未置顶线框） */}
            <Pressable
              style={styles.toolbarSlot}
              onPress={() => void notesStore.getState().togglePinAsync(note.id)}
              hitSlop={6}
              accessibilityLabel={note.isPinnedInList ? '取消置顶' : '置顶'}
            >
              <MaterialCommunityIcons
                name={note.isPinnedInList ? 'pin' : 'pin-outline'}
                size={22}
                color={note.isPinnedInList ? theme.text : theme.secondary}
              />
            </Pressable>
            {/* 调色盘：顶部 PopMenu */}
            <Pressable
              style={styles.toolbarSlot}
              onPress={() => setPaletteVisible(true)}
              hitSlop={6}
              accessibilityLabel="选择便签色彩"
            >
              <Ionicons name="color-palette-outline" size={22} color={theme.text} />
            </Pressable>
            {/* 编辑中显示完成对勾按钮 */}
            {isEditing ? (
              <Pressable
                style={styles.toolbarSlot}
                onPress={() => {
                  Keyboard.dismiss();
                  setIsEditing(false);
                }}
                hitSlop={6}
                accessibilityLabel="完成编辑"
              >
                <Ionicons name="checkmark" size={24} color={theme.text} />
              </Pressable>
            ) : null}
            <Pressable
              style={styles.toolbarSlot}
              onPress={() => setMenuVisible(true)}
              hitSlop={6}
              accessibilityLabel="更多选项"
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.text} />
            </Pressable>
          </View>
        </View>

        {/* 内容区：只读态走外层 ScrollView（Text 随内容撑开，天然可滚动），
            编辑态以 TextInput 自身为滚动主体（其默认 scrollEnabled，长便签内部滚动）。
            二者不可合并：一旦给 TextInput 加 flex 高度约束又禁用自身滚动，长便签就彻底滚不动。 */}
        {isEditing ? (
          <TextInput
            ref={inputRef}
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
        ) : (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.readContent}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <Pressable style={styles.readPressable} onPress={startEditing}>
              <Text
                style={{
                  color: content ? theme.text : theme.secondary,
                  fontSize,
                  lineHeight: Math.round((fontSize * LINE_HEIGHT.body) / FONT.body),
                }}
              >
                {content || '记录点什么...'}
              </Text>
            </Pressable>
          </ScrollView>
        )}

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
    paddingHorizontal: SPACING.sm,
    // 与 Stack AppBar（56dp）保持统一高度
    height: APPBAR_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarSlot: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  readContent: {
    flexGrow: 1,
  },
  readPressable: {
    flexGrow: 1,
    padding: SPACING.lg,
  },
  editor: {
    flex: 1,
    padding: SPACING.lg,
    minHeight: 200,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statusText: {
    fontSize: FONT.small,
    lineHeight: LINE_HEIGHT.small,
  },
});
