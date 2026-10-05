// 便签文件 Wire 格式 (JSON Schema v1) 与同步铁律实现（方案 §2.2 / §2.3 / §4.3）

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
  content: string;
  color: string;
  isPinnedInList: boolean;
  alwaysOnTop: boolean;
  isDeleted: boolean;
  createdAt: string; // 严格 ISO-8601 UTC 原始字符串
  updatedAt: string;
  deviceId?: string;
}

export function serializeDto(dto: SyncNoteDto): string {
  const body = {
    schemaVersion: dto.schemaVersion,
    id: dto.id,
    content: normalizeNewlines(dto.content),
    color: dto.color,
    isPinnedInList: dto.isPinnedInList,
    alwaysOnTop: dto.alwaysOnTop,
    isDeleted: dto.isDeleted,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    ...(dto.deviceId ? { deviceId: dto.deviceId } : {}),
  };
  return JSON.stringify(body);
}

/** 防御性解析：任何字段非法均返回 null，由引擎跳过该文件 */
export function parseDto(jsonText: string, expectedKey?: string): SyncNoteDto | null {
  try {
    const json = JSON.parse(jsonText) as Record<string, unknown>;
    const v = typeof json['schemaVersion'] === 'number' ? json['schemaVersion'] : 1;
    if (v > 1) return null; // 陌生高版本忽略

    const id = typeof json['id'] === 'string' ? json['id'].toLowerCase() : '';
    if (!id) return null;
    if (expectedKey && expectedKey.toLowerCase() !== noteKey(id)) {
      return null; // ID 与文件名不一致防护
    }

    return {
      schemaVersion: v,
      id,
      content: normalizeNewlines(typeof json['content'] === 'string' ? json['content'] : ''),
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

/** 防乒乓（铁律 4）：仅比较业务内容字段，时间戳差异不触发传输 */
export function businessEquals(a: NoteLike, b: NoteLike): boolean {
  return (
    normalizeNewlines(a.content) === normalizeNewlines(b.content) &&
    a.color === b.color &&
    a.isPinnedInList === b.isPinnedInList &&
    a.alwaysOnTop === b.alwaysOnTop &&
    a.isDeleted === b.isDeleted
  );
}

export function dtoFromNote(note: NoteLike, deviceId: string): SyncNoteDto {
  return {
    schemaVersion: 1,
    id: note.id,
    content: normalizeNewlines(note.content),
    color: note.color,
    isPinnedInList: note.isPinnedInList,
    alwaysOnTop: note.alwaysOnTop,
    isDeleted: note.isDeleted,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deviceId,
  };
}

export function noteFromDto(dto: SyncNoteDto): NoteLike {
  return {
    id: dto.id,
    content: normalizeNewlines(dto.content),
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
