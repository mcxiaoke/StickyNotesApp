import { noteColorFromString, type NoteColor } from './theme';

export interface Note {
  id: string; // UUID 小写 36 字符
  content: string; // 一律 \n 换行
  color: NoteColor;
  isPinnedInList: boolean;
  alwaysOnTop: boolean; // 移动端不生效，同步保留字段
  isDeleted: boolean;
  createdAt: string; // ISO-8601 UTC 原始字符串（不回填、不重写）
  updatedAt: string;
}

export interface NoteRow {
  id: string;
  content: string;
  color: string;
  is_pinned_in_list: number;
  always_on_top: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}

export function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    content: row.content,
    color: noteColorFromString(row.color),
    isPinnedInList: row.is_pinned_in_list === 1,
    alwaysOnTop: row.always_on_top === 1,
    isDeleted: row.is_deleted === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 生成协议要求的 ISO-8601 UTC round-trip 时间戳（.0000000Z 七位小数）。
 * 依赖 `Date.prototype.toISOString` 固定输出 3 位毫秒这个前提（ECMA-262 规定），
 * 因此这里把 3 位补齐为 7 位；若该前提变化，本函数需同步调整。
 */
export function nowIso(): string {
  return isoFromMs(Date.now());
}

export function isoFromMs(ms: number): string {
  const iso = new Date(ms).toISOString(); // 2026-10-04T07:30:00.123Z
  return iso.replace(/\.(\d{3})Z$/, (_m, ms: string) => `.${ms}0000Z`);
}

export function createNote(content: string, color: NoteColor): Note {
  const now = nowIso();
  return {
    id: generateUuidV4(),
    content,
    color,
    isPinnedInList: false,
    alwaysOnTop: false,
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** RFC 4122 v4 UUID（小写），随机源取自 expo-crypto */
export function generateUuidV4(): string {
  const bytes = new Uint8Array(16);
  getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getRandomValues(bytes: Uint8Array<ArrayBuffer>): void {
  // expo-crypto 在 RN 环境提供 getRandomValues；测试/node 环境退回全局 crypto
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as {
    getRandomValues: (arr: Uint8Array) => Uint8Array;
  };
  if (typeof Crypto?.getRandomValues === 'function') {
    Crypto.getRandomValues(bytes);
    return;
  }
  globalThis.crypto.getRandomValues(bytes);
}
