import * as SQLite from 'expo-sqlite';

export type AppDatabase = SQLite.SQLiteDatabase;

let dbInstance: AppDatabase | null = null;

export function openAppDatabase(): AppDatabase {
  if (dbInstance) return dbInstance;
  const db = SQLite.openDatabaseSync('stickynotes.db');
  db.execSync('PRAGMA journal_mode = WAL');
  migrate(db);
  dbInstance = db;
  return db;
}

export function getDatabase(): AppDatabase {
  if (!dbInstance) return openAppDatabase();
  return dbInstance;
}

const MIGRATIONS: string[] = [
  // v1：初始结构
  `
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    color TEXT NOT NULL,
    is_pinned_in_list INTEGER NOT NULL DEFAULT 0,
    always_on_top INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes (updated_at);
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
  `,
  // v2：硬删除台账（对照桌面端 hard_deleted.json）：id -> 本机彻底删除时刻(UTC)。
  // 纯本地产物，永不参与同步；与便签删除写在同一事务内，杜绝进程中断漏记。
  `
  CREATE TABLE IF NOT EXISTS hard_deleted (
    id TEXT PRIMARY KEY NOT NULL,
    deleted_at TEXT NOT NULL
  );
  `,
];

function migrate(db: AppDatabase): void {
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.withTransactionSync(() => {
      db.execSync(MIGRATIONS[v]);
      db.execSync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

// ---- 轻量 KV（设置、设备标识等非敏感配置；密码一律走 secure-store） ----

export function kvGet(key: string): string | null {
  const db = getDatabase();
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row?.value ?? null;
}

export function kvSet(key: string, value: string): void {
  getDatabase().runSync(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export function kvDelete(key: string): void {
  getDatabase().runSync('DELETE FROM kv WHERE key = ?', key);
}
