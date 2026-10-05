// 根布局：全局初始化（数据库、store 水合、后台同步注册）与主题 Provider
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { LIGHT_SHELL, DARK_SHELL } from '../constants/theme';
import { settingsStore, resolveScheme } from '../stores/settingsStore';
import { notesStore } from '../stores/notesStore';
import { syncStore } from '../stores/syncStore';
import { performSyncRound } from '../sync/syncRunner';
import { applyBackgroundSyncSchedule } from '../sync/scheduler';

export default function RootLayout() {
  const systemScheme = useColorScheme();
  const themeMode = settingsStore((s) => s.themeMode);
  const scheme = resolveScheme(themeMode, systemScheme === 'dark' ? 'dark' : systemScheme === 'light' ? 'light' : null);
  const shell = scheme === 'dark' ? DARK_SHELL : LIGHT_SHELL;

  useEffect(() => {
    void (async () => {
      settingsStore.getState().hydrate();
      syncStore.getState().hydrate();
      await notesStore.getState().refreshAsync();
      await applyBackgroundSyncSchedule();
    })();

    // 切前台 2 秒后自动对账一轮（捕获电脑端编辑后的下行数据）
    let fgTimer: ReturnType<typeof setTimeout> | null = null;
    const onForeground = () => {
      fgTimer = setTimeout(() => {
        performSyncRound('foreground')
          .catch(() => {})
          .finally(() => void notesStore.getState().refreshAsync());
      }, 2000);
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') onForeground();
    });
    return () => {
      if (fgTimer) clearTimeout(fgTimer);
      sub.remove();
    };
  }, []);

  return (
    <ThemeProvider
      value={{
        ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
        colors: {
          ...(scheme === 'dark' ? DarkTheme : DefaultTheme).colors,
          primary: shell.accent,
          background: shell.background,
          card: shell.surface,
          text: shell.text,
          border: shell.border,
        },
      }}
    >
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerTitleStyle: { color: shell.text },
            headerTintColor: shell.accent,
            headerStyle: { backgroundColor: shell.surface },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="note/[id]" options={{ headerShown: false }} />
          <Stack.Screen
            name="archive"
            options={{ title: '已归档便签', headerBackTitle: '返回' }}
          />
          <Stack.Screen name="settings/index" options={{ headerShown: false }} />
          <Stack.Screen name="settings/sync" options={{ title: '同步设置', headerBackTitle: '返回' }} />
        </Stack>
      </GestureHandlerRootView>
    </ThemeProvider>
  );
}
