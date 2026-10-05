// 导出/导入纯逻辑单测：格式包装、桌面端 JSON 字段兼容、无效条目统计
import { buildExportPayload, parseImportPayload, EXPORT_FORMAT, type ImportNote } from '../src/services/backupData';
import type { Note } from '../src/data/note';

const BASE_NOTE: Note = {
  id: '0a3fd92e-6b1c-4c2a-9f11-2f5d6a8b7c01',
  content: '第一行\n第二行',
  color: 'yellow',
  isPinnedInList: true,
  alwaysOnTop: false,
  isDeleted: false,
  createdAt: '2026-10-04T07:30:00.0000000Z',
  updatedAt: '2026-10-04T07:31:00.0000000Z',
};

describe('buildExportPayload', () => {
  it('wraps notes with format header', () => {
    const payload = JSON.parse(buildExportPayload([BASE_NOTE]));
    expect(payload.format).toBe(EXPORT_FORMAT);
    expect(payload.version).toBe(1);
    expect(typeof payload.exportedAt).toBe('string');
    expect(payload.notes).toHaveLength(1);
    expect(payload.notes[0].id).toBe(BASE_NOTE.id);
  });
});

describe('parseImportPayload', () => {
  it('round-trips own export', () => {
    const text = buildExportPayload([BASE_NOTE]);
    const result = parseImportPayload(text);
    expect(result.invalid).toBe(0);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({
      id: BASE_NOTE.id,
      content: BASE_NOTE.content,
      color: 'yellow',
      isPinnedInList: true,
      isDeleted: false,
      createdAt: BASE_NOTE.createdAt,
      updatedAt: BASE_NOTE.updatedAt,
    } satisfies Partial<ImportNote>);
  });

  it('accepts bare array payload', () => {
    const result = parseImportPayload(JSON.stringify([{ id: 'x', content: 'hi' }]));
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].content).toBe('hi');
  });

  it('tolerates PascalCase fields and unknown window fields (desktop export)', () => {
    const text = JSON.stringify([
      {
        Id: 'aa',
        Content: 'CRLF\r\nlines',
        Color: 'green',
        IsPinnedInList: true,
        AlwaysOnTop: true,
        IsDeleted: false,
        CreatedAt: '2026-01-01T00:00:00.0000000Z',
        UpdatedAt: '2026-01-02T00:00:00.0000000Z',
        WindowX: 100,
        WindowY: 200,
        Width: 300,
        Height: 240,
        IsOpen: true,
      },
    ]);
    const result = parseImportPayload(text);
    expect(result.invalid).toBe(0);
    expect(result.notes[0]).toMatchObject({
      id: 'aa',
      content: 'CRLF\nlines',
      color: 'green',
      isPinnedInList: true,
      alwaysOnTop: true,
    });
  });

  it('counts invalid entries and fills missing optional fields', () => {
    const text = JSON.stringify([{ noId: true }, 'junk', null, { id: 'ok' }]);
    const result = parseImportPayload(text);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].id).toBe('ok');
    expect(result.notes[0].content).toBe('');
    expect(result.invalid).toBe(3);
  });

  it('normalizes boolean from number and string forms', () => {
    const result = parseImportPayload(
      JSON.stringify([
        { id: 'a', isPinnedInList: 1 },
        { id: 'b', isPinnedInList: 'true' },
        { id: 'c', isPinnedInList: 0 },
      ]),
    );
    expect(result.notes[0].isPinnedInList).toBe(true);
    expect(result.notes[1].isPinnedInList).toBe(true);
    expect(result.notes[2].isPinnedInList).toBe(false);
  });

  it('falls back to default color for unknown color values', () => {
    const result = parseImportPayload(JSON.stringify([{ id: 'a', color: 'neon-orange' }]));
    expect(result.notes[0].color).toBe('yellow');
  });

  it('throws on non-JSON text and wrong payload shape', () => {
    expect(() => parseImportPayload('not json')).toThrow();
    expect(() => parseImportPayload('{"foo": 1}')).toThrow();
  });
});
