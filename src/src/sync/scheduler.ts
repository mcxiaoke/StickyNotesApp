// 后台定时同步调度（方案 §4.6）：expo-background-task 周期任务，
// Android 底层为 WorkManager，15 分钟为法定最小周期。
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { loadSyncSettings } from './settings';
import { performSyncRound } from './syncRunner';

export const BACKGROUND_SYNC_TASK = 'stickynotes-background-sync';

// defineTask 必须在模块全局作用域调用
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    await performSyncRound('background');
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** 按设置注册或注销后台周期任务（保存同步设置后调用） */
export async function applyBackgroundSyncSchedule(): Promise<void> {
  if (Platform.OS === 'web') return;
  // Expo Go 不含后台任务原生模块（需 development build），跳过注册避免警告
  if (Constants.appOwnership === 'expo') return;
  const settings = loadSyncSettings();
  if (!settings.enabled) {
    if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    }
    return;
  }
  // expo-background-task 仅在电量充足且网络可用时执行；interval 单位为分钟。
  // Expo Go 中该 API 不可用（需 development build），静默降级：仅前台同步生效。
  try {
    await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: Math.max(15, settings.backgroundSyncMinutes),
    });
  } catch {
    // 后台任务注册失败不阻断设置保存
  }
}
