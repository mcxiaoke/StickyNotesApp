// 根布局：全局初始化（数据库、store 水合、后台同步注册）与主题 Provider
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { LIGHT_SHELL, DARK_SHELL } from '../constants/theme';
import { settingsStore, resolveScheme } from '../stores/settingsStore';
import { lockStore } from '../stores/lockStore';
import { notesStore } from '../stores/notesStore';
import { syncStore } from '../stores/syncStore';
import { crashStore } from '../stores/crashStore';
import { performSyncRound } from '../sync/syncRunner';
import { applyBackgroundSyncSchedule } from '../sync/scheduler';
import { runDailyBackupIfDueAsync } from '../services/dbBackup';
import { installGlobalErrorHandlers } from '../services/crash';
import { logger } from '../services/logger';
import { AppErrorBoundary } from '../components/AppErrorBoundary';
import { CrashScreen } from '../components/CrashScreen';
import { LockScreen } from '../components/LockScreen';

// 全局错误钩子必须在首次渲染前安装
installGlobalErrorHandlers();

export default function RootLayout() {
  const systemScheme = useColorScheme();
  const themeMode = settingsStore((s) => s.themeMode);
  const fatalError = crashStore((s) => s.fatalError);
  const scheme = resolveScheme(themeMode, systemScheme === 'dark' ? 'dark' : systemScheme === 'light' ? 'light' : null);
  const shell = scheme === 'dark' ? DARK_SHELL : LIGHT_SHELL;

  useEffect(() => {
    void (async () => {
      settingsStore.getState().hydrate();
      syncStore.getState().hydrate();
      await lockStore.getState().hydrate();
      await notesStore.getState().refreshAsync();
      await applyBackgroundSyncSchedule();
      // 每日一次的本地冷备份（同步之外的最后防线），失败不影响主流程
      void runDailyBackupIfDueAsync().catch((ex) =>
        logger.warn('backup', `daily backup failed: ${ex instanceof Error ? ex.message : String(ex)}`),
      );
    })();

    // 切前台 2 秒后自动对账一轮（捕获电脑端编辑后的下行数据）
    let fgTimer: ReturnType<typeof setTimeout> | null = null;
    const onForeground = () => {
      fgTimer = setTimeout(() => {
        performSyncRound('foreground')
          .catch((ex) => logger.warn('sync', `foreground round failed: ${ex instanceof Error ? ex.message : String(ex)}`))
          .finally(() => void notesStore.getState().refreshAsync());
      }, 2000);
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        lockStore.getState().maybeRelockOnForeground();
        onForeground();
      } else if (state === 'background') {
        lockStore.getState().markBackgrounded();
      }
    });
    return () => {
      if (fgTimer) clearTimeout(fgTimer);
      sub.remove();
    };
  }, []);

  // release 全局异常：崩溃屏接管整个应用（保持进程存活，可复制信息）
  if (fatalError) {
    return (
      <CrashScreen
        report={fatalError}
        onReset={() => crashStore.getState().dismissFatal()}
      />
    );
  }

  // 应用锁：锁存水合完成前保持空屏，锁定期间不渲染任何业务内容
  const lockHydrated = lockStore((s) => s.hydrated);
  const locked = lockStore((s) => s.locked);
  if (!lockHydrated) return null;
  if (locked) {
    return (
      <AppErrorBoundary>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <LockScreen />
      </AppErrorBoundary>
    );
  }

  return (
    <AppErrorBoundary>
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
    </AppErrorBoundary>
  );
}
