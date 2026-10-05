// 本地 SQLite 每日冷备份：VACUUM INTO 生成快照，滚动保留最近 N 份
// 备份目录位于应用私有文档目录（卸载即清除），作为同步之外的最后防线
import { Directory, File, Paths } from 'expo-file-system';

import { getDatabase, kvGet, kvSet } from '../data/db';
import {
  BACKUP_FILE_PREFIX,
  BACKUP_KEEP,
  backupFileName,
  localDateString,
  pickPruneNames,
} from './backupData';
import { logger } from './logger';

const KV_LAST_BACKUP_DATE = 'backup.lastDate.v1';
const BACKUP_DIR_NAME = 'backups';

export function getLastBackupDate(): string | null {
  return kvGet(KV_LAST_BACKUP_DATE);
}

/** 当天尚未备份时执行一次；返回是否实际执行 */
export async function runDailyBackupIfDueAsync(today: string = localDateString()): Promise<boolean> {
  if (kvGet(KV_LAST_BACKUP_DATE) === today) return false;
  await createBackupAsync(today);
  return true;
}

export async function createBackupAsync(dateStr: string = localDateString()): Promise<void> {
  const db = getDatabase();
  const dir = new Directory(Paths.document, BACKUP_DIR_NAME);
  dir.create({ idempotent: true });

  const dest = new File(dir, backupFileName(dateStr));
  if (dest.exists) dest.delete();
  const localPath = dest.uri.replace(/^file:\/\//, '').replace(/'/g, "''");
  // VACUUM INTO 输出已校验点（checkpointed）的完整快照，不含 WAL 残留
  await db.execAsync(`VACUUM INTO '${localPath}'`);

  pruneOldBackups(dir);
  kvSet(KV_LAST_BACKUP_DATE, dateStr);
  logger.info('backup', `database backed up: ${dest.name}`);
}

function pruneOldBackups(dir: Directory): void {
  const names = dir
    .list()
    .filter(
      (entry): entry is File =>
        entry instanceof File && entry.name.startsWith(BACKUP_FILE_PREFIX) && entry.name.endsWith('.db'),
    )
    .map((f) => f.name);
  for (const stale of pickPruneNames(names, BACKUP_KEEP)) {
    try {
      new File(dir, stale).delete();
      logger.info('backup', `pruned old backup: ${stale}`);
    } catch (ex) {
      logger.warn('backup', `prune failed for ${stale}: ${String(ex)}`);
    }
  }
}
