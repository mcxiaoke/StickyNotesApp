// 硬删除台账（对照桌面端 Services/HardDeleteLedger.cs）：记录「本机彻底删除过哪些便签、何时删的」，
// 供同步引擎对账时否决远端回流并在云端不新于删除时刻时主动推墓碑（P2-1 修复，协议零影响）。
//
// 台账是纯本地产物，永不参与同步。桌面端以 JSON 文件存储，移动端复用应用 SQLite（hard_deleted 表）：
// 记录动作由 noteRepository 在删除事务内完成，比「删除成功后另写文件」更强，进程随时退出都不会漏记。

import { openAppDatabase, type AppDatabase } from './db';
import { isoFromMs } from './note';

const GC_AFTER_MS = 365 * 24 * 60 * 60 * 1000;

/** 同步引擎依赖的最小抽象，便于单测以内存实现替换 */
export interface HardDeleteLedgerReader {
  /** id -> 删除时刻（UTC ISO-8601） */
  loadAsync(): Promise<Map<string, string>>;
}

// 每 App 会话只做一次 GC，避免每轮同步都产生写放大
let gcDone = false;

function gcIfNeeded(db: AppDatabase): void {
  if (gcDone) return;
  db.runSync('DELETE FROM hard_deleted WHERE deleted_at < ?', isoFromMs(Date.now() - GC_AFTER_MS));
  gcDone = true;
}

/** 供对账使用：载入台账索引。损坏/缺失由表结构天然兜底，最坏结果为回收站回填一次 */
export async function loadAsync(): Promise<Map<string, string>> {
  const db = openAppDatabase();
  gcIfNeeded(db);
  const rows = db.getAllSync<{ id: string; deleted_at: string }>(
    'SELECT id, deleted_at FROM hard_deleted',
  );
  return new Map(rows.map((r) => [r.id, r.deleted_at]));
}

/** SyncEngine 的默认台账依赖（单测可注入内存实现替换） */
export const hardDeleteLedger: HardDeleteLedgerReader = { loadAsync };

/**
 * 事务内记录：必须由调用方（noteRepository 的物理删除入口）在同一个
 * withTransactionSync 内调用，保证「删除行」与「记账」原子完成。
 * 重复删除同一 id 以较新时刻覆盖（最新一次彻底删除才是有效否决点）。
 */
export function recordInTransaction(db: AppDatabase, ids: readonly string[], deletedAt: string): void {
  for (const id of ids) {
    db.runSync(
      `INSERT INTO hard_deleted (id, deleted_at) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at`,
      id,
      deletedAt,
    );
  }
}
