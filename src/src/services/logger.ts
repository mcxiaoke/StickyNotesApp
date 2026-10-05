// 进程内日志服务：环形缓冲，设置页可复制导出。
// 铁律 8：同步日志禁止打印便签正文——调用方只允许传 key/统计/错误消息，不允许传 content。
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  time: string;
  level: LogLevel;
  tag: string;
  message: string;
  seq: number;
}

const MAX_ENTRIES = 300;
const buffer: LogEntry[] = [];
let seq = 0;

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

  // 同步镜像到系统控制台，便于 Metro/adb logcat 观察
  const line = `[${tag}] ${entry.message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
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
  count(): number {
    return buffer.length;
  },
  clear(): void {
    buffer.length = 0;
  },
};
