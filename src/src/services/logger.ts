// 进程内日志服务：环形缓冲 + 订阅通知 + warn/error 落盘，设置页日志界面实时查看。
// 铁律 8：同步日志禁止打印便签正文——调用方只允许传 key/统计/错误消息，不允许传 content。
import { appendPersistedAsync } from './logPersist';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  time: string;
  level: LogLevel;
  tag: string;
  message: string;
  seq: number;
}

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];
const listeners = new Set<() => void>();
let seq = 0;
// useSyncExternalStore 要求快照引用稳定：仅在缓冲变化时整体重建，不做原地修改
let snapshot: LogEntry[] = [];

function rebuildSnapshot(): void {
  snapshot = [...buffer].reverse();
}

function notify(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      // 订阅者异常不影响日志主流程
    }
  }
}

function formatLine(e: LogEntry): string {
  return `${e.time} [${e.level.toUpperCase()}] [${e.tag}] ${e.message}`;
}

function push(level: LogLevel, tag: string, message: string): void {
  seq++;
  const entry: LogEntry = {
    time: new Date().toISOString(),
    level,
    tag,
    message: message.length > 2000 ? message.slice(0, 2000) + '...<truncated>' : message,
    seq,
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  rebuildSnapshot();

  // warn/error 追加落盘（崩溃/重启后仍可随导出带走）；写失败静默，绝不影响主流程
  if (level === 'warn' || level === 'error') void appendPersistedAsync(formatLine(entry));

  // 同步镜像到系统控制台，便于 Metro/adb logcat 观察；debug 只进缓冲不刷 console
  const line = `[${tag}] ${entry.message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level !== 'debug') console.log(line);

  notify();
}

/** 统一的错误描述：name: message + cause 链（最多 3 层），比裸 ex.message 更可排查 */
export function describeError(ex: unknown): string {
  let cur: unknown = ex;
  let out = '';
  let depth = 0;
  while (cur != null && depth < 3) {
    if (cur instanceof Error) {
      out += out ? ` <- ${cur.name}: ${cur.message}` : `${cur.name}: ${cur.message}`;
      cur = (cur as { cause?: unknown }).cause;
      depth++;
    } else {
      out += out ? ` <- ${String(cur)}` : String(cur);
      break;
    }
  }
  return out || String(ex);
}

export const logger = {
  debug(tag: string, message: string): void {
    push('debug', tag, message);
  },
  info(tag: string, message: string): void {
    push('info', tag, message);
  },
  warn(tag: string, message: string): void {
    push('warn', tag, message);
  },
  error(tag: string, message: string): void {
    push('error', tag, message);
  },
  /** 导出为可复制的文本（新在前），可选级别过滤 */
  getLines(): string[] {
    return [...buffer]
      .reverse()
      .map((e) => `${e.time} [${e.level.toUpperCase()}] [${e.tag}] ${e.message}`);
  },
  /** 条目快照（新在前，只读；引用在两次变更间保持稳定，供 useSyncExternalStore 使用） */
  getEntries(): readonly LogEntry[] {
    return snapshot;
  },
  /** 订阅日志变更（push/clear 后通知）；返回取消订阅函数 */
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  count(): number {
    return buffer.length;
  },
  clear(): void {
    buffer.length = 0;
    rebuildSnapshot();
    notify();
  },
};
