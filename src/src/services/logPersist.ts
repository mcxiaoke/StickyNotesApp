// warn/error 日志落盘持久化：Paths.document/logs/stickynotes-logs.log。
// 目的：崩溃或进程被杀重启后内存缓冲为空时，历史 warn/error 仍可随「导出日志」一起带走。
// 策略（docs/LOGGING-DESIGN-20261006.md 已定）：追加写；超过 1MB 截断重写（不保留 .old）。
// 约束：日志系统自身不允许抛错影响主流程，所有 I/O 失败一律静默。
import { File, Paths } from 'expo-file-system';

const LOG_FILE = 'logs/stickynotes-logs.log';
/** 1MB 上限，超过即截断重写 */
const MAX_BYTES = 1024 * 1024;

let fileRef: File | null = null;
// 串行化写入：expo-file-system 的 write 是覆盖写（读旧内容拼接后整体写回），并发会互相覆盖
let queue: Promise<void> = Promise.resolve();

function file(): File | null {
  if (fileRef) return fileRef;
  try {
    fileRef = new File(Paths.document, LOG_FILE);
    return fileRef;
  } catch {
    return null;
  }
}

async function doAppend(line: string): Promise<void> {
  const f = file();
  if (!f) return;
  if (!f.exists) {
    f.create({ intermediates: true });
    f.write(line + '\n');
    return;
  }
  if (f.size > MAX_BYTES) {
    // 截断重写：丢弃旧历史，从最新一条重新开始
    f.write(line + '\n');
    return;
  }
  f.write((await f.text()) + line + '\n');
}

/** 追加一条 warn/error 日志行（fire-and-forget，内部串行，失败静默） */
export function appendPersistedAsync(line: string): Promise<void> {
  queue = queue.then(() => doAppend(line)).catch(() => undefined);
  return queue;
}

/** 读取全部落盘日志（无文件或读取失败返回空串）；供导出时与内存缓冲合并 */
export async function readPersistedTextAsync(): Promise<string> {
  try {
    const f = file();
    if (!f || !f.exists) return '';
    return await f.text();
  } catch {
    return '';
  }
}

/** 清除落盘日志（设置页「清空日志」同时清内存与落盘）；失败静默 */
export async function clearPersistedAsync(): Promise<void> {
  try {
    const f = file();
    if (f && f.exists) f.delete();
  } catch {
    // 静默
  }
}
