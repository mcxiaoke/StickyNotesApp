// 便签文件 Wire 格式 (JSON Schema v1) 与同步铁律实现（对照桌面端 SyncProtocol / SyncNoteDto）。
//
// 明文模式：包含 content，不含 iv / payload；
// 密文模式：包含 iv + payload，绝不包含 content（序列化时省略字段）。
// 明密文严格互斥，从源头杜绝未解密密文被当作正常正文刷入 UI 或入库。

import { createMagicPayload, unwrapMagicPayload } from './crypto/cryptoHelper';
import { SCHEMA_VERSION } from './protocol';

const NEWLINE_RE = /\r\n|\r/g;
export const normalizeNewlines = (s: string): string => s.replace(NEWLINE_RE, '\n');

/** 远端对象统一为 <根>/notes/<小写Guid>.json（id 强制小写，与桌面端 Guid.ToString("D") 一致） */
export const NOTES_PREFIX = 'notes/';
export const noteKey = (id: string): string => `${NOTES_PREFIX}${id.toLowerCase()}.json`;

/** 单文件防呆上限，与桌面端 SyncProtocol.MaxNoteFileBytes 一致 */
export const MAX_NOTE_FILE_BYTES = 4 * 1024 * 1024;

export interface SyncNoteDto {
  schemaVersion: number; // 固定 1
  id: string; // 小写 UUID
  /** 明文正文；密文模式必须为 null（序列化时省略字段） */
  content: string | null;
  /** 密文模式 IV 的 Base64；明文模式必须为 null */
  iv: string | null;
  /** 密文模式载荷的 Base64；明文模式必须为 null */
  payload: string | null;
  color: string;
  isPinnedInList: boolean;
  alwaysOnTop: boolean;
  isDeleted: boolean;
  createdAt: string; // 严格 ISO-8601 UTC 原始字符串
  updatedAt: string;
  deviceId?: string;
}

/** 是否为密文便签（iv 与 payload 成对存在即视为密文） */
export function isEncryptedDto(dto: Pick<SyncNoteDto, 'iv' | 'payload'>): boolean {
  return typeof dto.iv === 'string' && dto.iv.length > 0 && typeof dto.payload === 'string' && dto.payload.length > 0;
}

/** 序列化：按模式输出互斥字段集，null 字段一律不落盘 */
export function serializeDto(dto: SyncNoteDto): string {
  const body: Record<string, unknown> = {
    schemaVersion: dto.schemaVersion,
    id: dto.id,
  };
  if (isEncryptedDto(dto)) {
    body['iv'] = dto.iv;
    body['payload'] = dto.payload;
  } else {
    body['content'] = normalizeNewlines(dto.content ?? '');
  }
  body['color'] = dto.color;
  body['isPinnedInList'] = dto.isPinnedInList;
  body['alwaysOnTop'] = dto.alwaysOnTop;
  body['isDeleted'] = dto.isDeleted;
  body['createdAt'] = dto.createdAt;
  body['updatedAt'] = dto.updatedAt;
  if (dto.deviceId) body['deviceId'] = dto.deviceId;
  return JSON.stringify(body);
}

/**
 * 防御性解析：任何字段非法均返回 null，由引擎跳过该文件（对照桌面端 SyncProtocol.TryDeserialize）。
 * 校验：schemaVersion 已知、id 与文件名一致、iv/payload 成对、明密文互斥。
 */
export function parseDto(jsonText: string, expectedKey?: string): SyncNoteDto | null {
  try {
    const json = JSON.parse(jsonText) as Record<string, unknown>;
    const v = typeof json['schemaVersion'] === 'number' ? json['schemaVersion'] : 1;
    if (v > SCHEMA_VERSION) return null; // 陌生高版本忽略

    const id = typeof json['id'] === 'string' ? json['id'].toLowerCase() : '';
    if (!id) return null;
    if (expectedKey && expectedKey.toLowerCase() !== noteKey(id)) {
      return null; // ID 与文件名不一致防护
    }

    const rawContent = typeof json['content'] === 'string' ? json['content'] : null;
    const iv = typeof json['iv'] === 'string' && json['iv'].length > 0 ? json['iv'] : null;
    const payload = typeof json['payload'] === 'string' && json['payload'].length > 0 ? json['payload'] : null;

    // iv 与 payload 必须成对出现
    if ((iv === null) !== (payload === null)) return null;
    // 明密文互斥：密文文件不得携带 content
    const encrypted = iv !== null && payload !== null;
    if (encrypted && rawContent !== null) return null;

    return {
      schemaVersion: v,
      id,
      content: encrypted ? null : normalizeNewlines(rawContent ?? ''),
      iv,
      payload,
      color: (typeof json['color'] === 'string' ? json['color'] : 'yellow').toLowerCase(),
      isPinnedInList: json['isPinnedInList'] === true,
      alwaysOnTop: json['alwaysOnTop'] === true,
      isDeleted: json['isDeleted'] === true,
      createdAt: typeof json['createdAt'] === 'string' ? json['createdAt'] : '',
      updatedAt: typeof json['updatedAt'] === 'string' ? json['updatedAt'] : '',
      deviceId: typeof json['deviceId'] === 'string' ? json['deviceId'] : undefined,
    };
  } catch {
    return null;
  }
}

/** LWW 时间比较：毫秒精度，非法字符串视为最早（0） */
export function tsValue(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** 参与业务比较的最小结构（明文 NoteLike 与同步 DTO 均可直接传入） */
export interface ComparableNote {
  content: string | null;
  color: string;
  isPinnedInList: boolean;
  alwaysOnTop: boolean;
  isDeleted: boolean;
}

/** 防乒乓（铁律 4）：仅比较业务内容字段，时间戳差异不触发传输 */
export function businessEquals(a: ComparableNote, b: ComparableNote): boolean {
  return (
    normalizeNewlines(a.content ?? '') === normalizeNewlines(b.content ?? '') &&
    a.color === b.color &&
    a.isPinnedInList === b.isPinnedInList &&
    a.alwaysOnTop === b.alwaysOnTop &&
    a.isDeleted === b.isDeleted
  );
}

/** 从本地实体构造明文 DTO */
export function dtoFromNote(note: NoteLike, deviceId: string): SyncNoteDto {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: note.id,
    content: normalizeNewlines(note.content),
    iv: null,
    payload: null,
    color: note.color,
    isPinnedInList: note.isPinnedInList,
    alwaysOnTop: note.alwaysOnTop,
    isDeleted: note.isDeleted,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deviceId,
  };
}

/**
 * 从本地实体构造密文 DTO（正文注入 SN1: 魔数后 AES-256 加密存入 payload，content 置 null）。
 * fixedIv 仅用于确定性测试。
 */
export function dtoFromNoteEncrypted(
  note: NoteLike,
  deviceId: string,
  secret: string,
  fixedIv?: Uint8Array,
): SyncNoteDto {
  const normalized = normalizeNewlines(note.content);
  const { iv, payload } = createMagicPayload(normalized, secret, fixedIv);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: note.id,
    content: null,
    iv,
    payload,
    color: note.color,
    isPinnedInList: note.isPinnedInList,
    alwaysOnTop: note.alwaysOnTop,
    isDeleted: note.isDeleted,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deviceId,
  };
}

/** 解密远端密文 DTO 并剥离魔数；失败抛 SyncCryptoError（由引擎计入 skippedInvalid） */
export function decryptDtoContent(dto: SyncNoteDto, secret: string): string {
  if (!isEncryptedDto(dto)) throw new Error('非密文 DTO，无需解密');
  return unwrapMagicPayload(dto.iv as string, dto.payload as string, secret);
}

export function noteFromDto(dto: SyncNoteDto): NoteLike {
  return {
    id: dto.id,
    content: normalizeNewlines(dto.content ?? ''),
    color: dto.color,
    isPinnedInList: dto.isPinnedInList,
    alwaysOnTop: dto.alwaysOnTop,
    isDeleted: dto.isDeleted,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

/** 最小结构引用，避免 sync 层反向依赖 data 层造成环形导入 */
export interface NoteLike {
  id: string;
  content: string;
  color: string;
  isPinnedInList: boolean;
  alwaysOnTop: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}
