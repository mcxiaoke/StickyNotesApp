// 日志导出：落盘 warn/error 历史 + 内存缓冲按时间合并去重，写临时 txt 后调起系统分享。
// 崩溃/进程重启后内存缓冲为空，历史 warn/error 只存在于落盘文件中，因此导出必须合并两者（设计稿已定）。
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { logger } from './logger';
import { readPersistedTextAsync } from './logPersist';

/** 合并落盘历史与内存缓冲为时间正序的完整日志文本（含头部信息，便于外发排查） */
export async function buildLogsTextAsync(): Promise<string> {
  const persisted = await readPersistedTextAsync();
  const persistedLines = persisted ? persisted.split('\n').filter((l) => l.length > 0) : [];
  // 内存条目新在前 → 翻转为时间正序再合并；同一 entry 两边都出现时整行格式一致，按行去重
  const memoryLines = logger.getLines().reverse();
  const seen = new Set<string>();
  const merged = [...persistedLines, ...memoryLines].filter((l) => {
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
  // 行首为 ISO 时间戳，字典序即时间序
  merged.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const header = ['=== StickyNotes logs ===', `exported at ${new Date().toISOString()}`, ''].join('\n');
  return header + (merged.length > 0 ? merged.join('\n') : '（暂无日志）');
}

/** 写临时 txt 并调起系统分享（与 backup.exportNotesAsync 同一模式），分享完成删除临时文件 */
export async function exportLogsAsync(): Promise<void> {
  const text = await buildLogsTextAsync();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = new File(Paths.cache, `stickynotes-logs-${stamp}.txt`);
  file.create();
  file.write(text);
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'text/plain',
      dialogTitle: '导出日志',
    });
  } finally {
    file.delete();
  }
  logger.info('logs', `logs exported (${text.length} chars)`);
}
