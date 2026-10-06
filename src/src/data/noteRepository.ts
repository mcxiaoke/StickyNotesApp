import { getDatabase, openAppDatabase } from './db';
import { createNote, nowIso, rowToNote, type Note, type NoteRow } from './note';
import { noteColorFromString, type NoteColor } from './theme';
import type { NoteLike } from '../sync/dto';
import type { ImportNote } from '../services/backupData';

export interface RemoteApplyItem {
  /** 结构化最小字段（同步层 DTO 转换结果即可直接传入） */
  note: {
    id: string;
    content: string;
    color: string;
    isPinnedInList: boolean;
    alwaysOnTop: boolean;
    isDeleted: boolean;
    createdAt: string;
    updatedAt: string;
  };
  /** 对账快照时本地的 updatedAt；null 表示本地无此行（强制插入） */
  snapshotUpdatedAt: string | null;
}

export interface ApplyRemoteResult {
  applied: number;
  guardedSkipped: number;
}

/** 仓储接口：同步引擎依赖此抽象，便于单测以内存实现替换 */
export interface INoteRepository {
  getAllAsync(): Promise<NoteLike[]>;
  applyRemoteBatchAsync(items: RemoteApplyItem[]): Promise<ApplyRemoteResult>;
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n|\r/g, '\n');
}

export const noteRepository = {
  async getAllAsync(): Promise<Note[]> {
    openAppDatabase();
    const rows = getDatabase().getAllSync<NoteRow>(
      'SELECT * FROM notes ORDER BY updated_at DESC',
    );
    return rows.map(rowToNote);
  },

  async getByIdAsync(id: string): Promise<Note | null> {
    openAppDatabase();
    const row = getDatabase().getFirstSync<NoteRow>('SELECT * FROM notes WHERE id = ?', id);
    return row ? rowToNote(row) : null;
  },

  async createAsync(content: string, color: NoteColor): Promise<Note> {
    const note = createNote(normalizeContent(content), color);
    openAppDatabase();
    getDatabase().runSync(
      `INSERT INTO notes (id, content, color, is_pinned_in_list, always_on_top, is_deleted, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      note.id,
      note.content,
      note.color,
      note.isPinnedInList ? 1 : 0,
      note.alwaysOnTop ? 1 : 0,
      note.isDeleted ? 1 : 0,
      note.createdAt,
      note.updatedAt,
    );
    return note;
  },

  async updateContentAsync(id: string, content: string): Promise<void> {
    getDatabase().runSync(
      'UPDATE notes SET content = ?, updated_at = ? WHERE id = ?',
      normalizeContent(content),
      nowIso(),
      id,
    );
  },

  async updateColorAsync(id: string, color: NoteColor): Promise<void> {
    getDatabase().runSync(
      'UPDATE notes SET color = ?, updated_at = ? WHERE id = ?',
      noteColorFromString(color),
      nowIso(),
      id,
    );
  },

  async setPinnedInListAsync(id: string, pinned: boolean): Promise<void> {
    getDatabase().runSync(
      'UPDATE notes SET is_pinned_in_list = ?, updated_at = ? WHERE id = ?',
      pinned ? 1 : 0,
      nowIso(),
      id,
    );
  },

  /** 软删除（归档）：协议墓碑，同步时传播 isDeleted=true */
  async softDeleteAsync(id: string): Promise<void> {
    getDatabase().runSync(
      'UPDATE notes SET is_deleted = 1, updated_at = ? WHERE id = ?',
      nowIso(),
      id,
    );
  },

  async restoreAsync(id: string): Promise<void> {
    getDatabase().runSync(
      'UPDATE notes SET is_deleted = 0, updated_at = ? WHERE id = ?',
      nowIso(),
      id,
    );
  },

  /** 本地彻底删除（仅本地；远端墓碑文件由各端保留，不物理删除远端对象） */
  async purgeAsync(id: string): Promise<void> {
    getDatabase().runSync('DELETE FROM notes WHERE id = ?', id);
  },

  /**
   * JSON 导入（与桌面端一致：按 Id 幂等去重，已存在的跳过）。
   * 保留原始时间戳，便于后续按 LWW 与同步数据收敛。
   */
  async importNotesAsync(
    notes: ImportNote[],
  ): Promise<{ total: number; imported: number; skipped: number }> {
    const db = openAppDatabase();
    let imported = 0;
    let skipped = 0;
    db.withTransactionSync(() => {
      for (const note of notes) {
        const exists = db.getFirstSync('SELECT id FROM notes WHERE id = ?', note.id);
        if (exists) {
          skipped++;
          continue;
        }
        db.runSync(
          `INSERT INTO notes (id, content, color, is_pinned_in_list, always_on_top, is_deleted, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          note.id,
          normalizeContent(note.content),
          noteColorFromString(note.color),
          note.isPinnedInList ? 1 : 0,
          note.alwaysOnTop ? 1 : 0,
          note.isDeleted ? 1 : 0,
          note.createdAt,
          note.updatedAt,
        );
        imported++;
      }
    });
    return { total: notes.length, imported, skipped };
  },

  async purgeAllDeletedAsync(): Promise<void> {
    getDatabase().runSync('DELETE FROM notes WHERE is_deleted = 1');
  },

  /**
   * 下行批量应用（协议铁律 6：下行写守卫）。
   * 单事务内条件更新：仅当本地当前 updatedAt 与对账快照一致时才覆盖，
   * 快照后被本地编辑的行跳过，等下一轮全量对账重新收敛。
   * 事务开头一次载入 id → updated_at 全量映射，避免循环内逐行查询（N+1）。
   */
  async applyRemoteBatchAsync(items: RemoteApplyItem[]): Promise<ApplyRemoteResult> {
    const db = openAppDatabase();
    let applied = 0;
    let guardedSkipped = 0;

    db.withTransactionSync(() => {
      const versions = new Map<string, string>();
      for (const row of db.getAllSync<{ id: string; updated_at: string }>(
        'SELECT id, updated_at FROM notes',
      )) {
        versions.set(row.id, row.updated_at);
      }

      for (const item of items) {
        const note = item.note;
        const currentUpdatedAt = versions.get(note.id);

        if (currentUpdatedAt === undefined) {
          db.runSync(
            `INSERT INTO notes (id, content, color, is_pinned_in_list, always_on_top, is_deleted, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            note.id,
            normalizeContent(note.content),
            noteColorFromString(note.color),
            note.isPinnedInList ? 1 : 0,
            note.alwaysOnTop ? 1 : 0,
            note.isDeleted ? 1 : 0,
            note.createdAt,
            note.updatedAt,
          );
          versions.set(note.id, note.updatedAt);
          applied++;
        } else if (item.snapshotUpdatedAt !== null && currentUpdatedAt === item.snapshotUpdatedAt) {
          db.runSync(
            `UPDATE notes SET
               content = ?, color = ?, is_pinned_in_list = ?, always_on_top = ?,
               is_deleted = ?, updated_at = ?
             WHERE id = ?`,
            normalizeContent(note.content),
            noteColorFromString(note.color),
            note.isPinnedInList ? 1 : 0,
            note.alwaysOnTop ? 1 : 0,
            note.isDeleted ? 1 : 0,
            note.updatedAt,
            note.id,
          );
          versions.set(note.id, note.updatedAt);
          applied++;
        } else {
          guardedSkipped++;
        }
      }
    });

    return { applied, guardedSkipped };
  },
} satisfies INoteRepository & Record<string, unknown>;
