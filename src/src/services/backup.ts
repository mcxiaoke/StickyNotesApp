// 数据导出/导入：JSON 全量导出（系统分享）与文件导入（按 Id 幂等去重）
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { noteRepository } from '../data/noteRepository';
import { buildExportPayload, parseImportPayload, type ImportNote } from './backupData';
import { logger } from './logger';

export interface ImportSummary {
  total: number;
  imported: number;
  skipped: number;
  invalid: number;
}

/** 全量导出便签为 JSON 并调起系统分享；返回导出条数 */
export async function exportNotesAsync(): Promise<number> {
  const notes = await noteRepository.getAllAsync();
  const json = buildExportPayload(notes);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const file = new File(Paths.cache, `stickynotes-export-${stamp}.json`);
  file.create();
  file.write(json);
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: '导出便签数据',
    });
  } finally {
    file.delete();
  }
  logger.info('backup', `exported ${notes.length} notes to JSON`);
  return notes.length;
}

/** 选择 JSON 文件导入；用户取消返回 null；按 Id 幂等，已存在的跳过 */
export async function importNotesAsync(): Promise<ImportSummary | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json'] });
  if (picked.canceled || !picked.result) return null;

  const text = await picked.result.text();
  const parsed = parseImportPayload(text);
  const { imported, skipped } = await noteRepository.importNotesAsync(parsed.notes);
  logger.info(
    'backup',
    `import from file: total=${parsed.notes.length} imported=${imported} skipped=${skipped} invalid=${parsed.invalid}`,
  );
  return {
    total: parsed.notes.length,
    imported,
    skipped,
    invalid: parsed.invalid,
  };
}

export type { ImportNote };
