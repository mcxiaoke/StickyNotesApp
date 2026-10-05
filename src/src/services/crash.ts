// 崩溃与全局错误处理：
// 1) 全局未捕获异常 → 记录到 kv + 内存日志；release 下用内置崩溃屏接管（保持进程存活，可复制信息）。
// 2) 未处理的 Promise rejection → 记录到日志（不再静默）。
// 3) React 渲染错误由 ErrorBoundary 兜底（见 components/ErrorBoundary.tsx）。
import { kvGet, kvSet, kvDelete } from '../data/db';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { logger } from './logger';
import { crashStore } from '../stores/crashStore';

const CRASH_KEY = 'app.lastCrash.v1';

export function formatError(error: unknown, context: string): string {
  const lines: string[] = [];
  lines.push(`=== StickyNotes Crash Report ===`);
  lines.push(`time: ${new Date().toISOString()}`);
  lines.push(`context: ${context}`);
  lines.push(`platform: ${Platform.OS} ${Platform.Version}`);
  lines.push(`app: v${Constants.expoConfig?.version ?? '?'} (sdk ${Constants.expoConfig?.sdkVersion ?? '?'})`);
  lines.push('');
  if (error instanceof Error) {
    lines.push(`${error.name}: ${error.message}`);
    if (error.stack) lines.push(error.stack);
    const cause = (error as { cause?: unknown }).cause;
    if (cause != null) {
      lines.push('');
      lines.push('--- cause ---');
      lines.push(cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause));
    }
  } else {
    lines.push(String(error));
  }
  return lines.join('\n');
}

export function getLastCrash(): string | null {
  return kvGet(CRASH_KEY);
}

export function clearLastCrash(): void {
  kvDelete(CRASH_KEY);
}

function recordCrash(error: unknown, context: string): string {
  const report = formatError(error, context);
  try {
    kvSet(CRASH_KEY, report);
  } catch (ex) {
    // 记录崩溃本身失败时不能再抛
    logger.error('crash', `failed to persist crash report: ${String(ex)}`);
  }
  logger.error('crash', report.split('\n').slice(0, 6).join(' | '));
  return report;
}

/**
 * 安装全局错误钩子。必须在应用根模块加载时（渲染开始前）调用一次。
 */
export function installGlobalErrorHandlers(): void {
  // 1. 未捕获异常（渲染之外的 JS 错误、定时器回调等）
  try {
    const errorUtils = (globalThis as { ErrorUtils?: {
      getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
      setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
    } }).ErrorUtils;
    if (errorUtils?.setGlobalHandler) {
      const defaultHandler = errorUtils.getGlobalHandler?.();
      errorUtils.setGlobalHandler((error, isFatal) => {
        const report = recordCrash(error, `uncaught${isFatal === false ? '' : '/fatal'}`);
        if (__DEV__) {
          // 开发环境保留默认红屏行为
          defaultHandler?.(error, isFatal);
          return;
        }
        // release：不交还默认处理器（默认会直接崩溃），用内置崩溃屏接管
        crashStore.getState().showFatal(report);
      });
      logger.info('crash', 'global error handler installed');
    }
  } catch (ex) {
    logger.warn('crash', `failed to install global handler: ${String(ex)}`);
  }

  // 2. 未处理的 Promise rejection（RN 的 promise polyfill 提供跟踪钩子）
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require('promise/setimmediate/rejection-tracking') as {
      enable?: (options: Record<string, unknown>) => void;
    };
    tracking.enable?.({
      allRejections: true,
      onUnhandled: (_id: number, error?: unknown) => {
        const message =
          error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
        logger.error('unhandledRejection', message);
      },
    });
    logger.info('crash', 'unhandled rejection tracking installed');
  } catch {
    // polyfill 钩子不可用时跳过（不影响运行）
    logger.warn('crash', 'promise rejection tracking unavailable');
  }
}
