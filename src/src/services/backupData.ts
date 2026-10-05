// 导出/导入纯逻辑：不依赖 expo 模块，便于单测
// 导出格式与桌面端 JSON 备份兼容：导入容忍 PascalCase/camelCase 字段名与多余字段（窗口坐标等）
import { nowIso } from '../data/note';
import { noteColorFromString } from '../data/theme';

export const EXPORT_FORMAT = 'stickynotes-notes';
export const EXPORT_VERSION = 1;

// ---- 本地 SQLite 每日备份（纯命名/挑选逻辑，供 dbBackup 使用） ----

export const BACKUP_KEEP = 7;
export const BACKUP_FILE_PREFIX = 'notes-';

/** 本地时区 YYYY-MM-DD */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function backupFileName(dateStr: string): string {
  return `${BACKUP_FILE_PREFIX}${dateStr.slice(0, 10).replace(/-/g, '')}.db`;
}

/** 按文件名（YYYYMMDD 字典序即时间序）倒序保留 keep 份，返回应删除名单 */
export function pickPruneNames(names: string[], keep: number = BACKUP_KEEP): string[] {
  return [...names].sort().reverse().slice(Math.max(keep, 0));
}

export interface ImportNote {
  id: string;
  content: string;
  color: string;
  isPinnedInList: boolean;
  alwaysOnTop: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ParseImportResult {
  notes: ImportNote[];
  /** 无法解析的条目数 */
  invalid: number;
}

export function buildExportPayload(notes: unknown[]): string {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: nowIso(),
    notes,
  });
}

function pickString(raw: Record<string, unknown>, camel: string, pascal: string): string | null {
  const v = raw[camel] ?? raw[pascal];
  return typeof v === 'string' ? v : null;
}

function pickBool(raw: Record<string, unknown>, camel: string, pascal: string): boolean {
  const v = raw[camel] ?? raw[pascal];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

function normalizeItem(raw: Record<string, unknown>): ImportNote | null {
  const id = pickString(raw, 'id', 'Id');
  if (!id || !id.trim()) return null;
  const now = nowIso();
  const content = pickString(raw, 'content', 'Content') ?? '';
  const color = pickString(raw, 'color', 'Color') ?? 'yellow';
  const createdAt = pickString(raw, 'createdAt', 'CreatedAt') ?? now;
  const updatedAt = pickString(raw, 'updatedAt', 'UpdatedAt') ?? createdAt;
  return {
    id: id.trim(),
    content: content.replace(/\r\n|\r/g, '\n'),
    color: noteColorFromString(color),
    isPinnedInList: pickBool(raw, 'isPinnedInList', 'IsPinnedInList'),
    alwaysOnTop: pickBool(raw, 'alwaysOnTop', 'AlwaysOnTop'),
    isDeleted: pickBool(raw, 'isDeleted', 'IsDeleted'),
    createdAt,
    updatedAt,
  };
}

/** 解析导入文本：兼容包装对象 / 裸数组，字段大小写不敏感，忽略未知字段 */
export function parseImportPayload(text: string): ParseImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }

  let list: unknown;
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).notes)) {
    list = (parsed as Record<string, unknown>).notes;
  } else {
    throw new Error('文件格式不正确：缺少便签数据');
  }

  const notes: ImportNote[] = [];
  let invalid = 0;
  for (const item of list as unknown[]) {
    if (item === null || typeof item !== 'object') {
      invalid++;
      continue;
    }
    const normalized = normalizeItem(item as Record<string, unknown>);
    if (normalized) notes.push(normalized);
    else invalid++;
  }
  return { notes, invalid };
}
