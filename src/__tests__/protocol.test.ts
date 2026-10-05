// Schema v1 校验与防乒乓（铁律 1/4/5）：序列化、防御性解析、业务比较
import {
  businessEquals,
  normalizeNewlines,
  noteKey,
  parseDto,
  serializeDto,
  tsValue,
  type SyncNoteDto,
} from '../src/sync/dto';

const VALID_DTO: SyncNoteDto = {
  schemaVersion: 1,
  id: '9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab',
  content: '便签正文（纯文本，\n换行）',
  color: 'yellow',
  isPinnedInList: false,
  alwaysOnTop: false,
  isDeleted: false,
  createdAt: '2026-10-04T03:00:00.0000000Z',
  updatedAt: '2026-10-04T07:30:00.0000000Z',
  deviceId: 'android-a7b3cd',
};

describe('SyncProtocol / dto', () => {
  test('normalizeNewlines converts CRLF and CR to LF', () => {
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });

  test('noteKey format is notes/<lowercase-id>.json', () => {
    expect(noteKey('9F3C8A4E-1B2D-4C3E-A5F6-0123456789AB')).toBe(
      'notes/9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab.json',
    );
  });

  test('serializeDto emits strict field set and normalized newlines', () => {
    const json = serializeDto({ ...VALID_DTO, content: 'a\r\nb' });
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        'alwaysOnTop',
        'color',
        'content',
        'createdAt',
        'deviceId',
        'id',
        'isDeleted',
        'isPinnedInList',
        'schemaVersion',
        'updatedAt',
      ].sort(),
    );
    expect(parsed.content).toBe('a\nb');
    expect(parsed.schemaVersion).toBe(1);
  });

  test('serializeDto omits deviceId when absent', () => {
    const { deviceId: _ignored, ...withoutDevice } = VALID_DTO;
    const parsed = JSON.parse(serializeDto(withoutDevice));
    expect('deviceId' in parsed).toBe(false);
  });

  test('parseDto round-trips a valid payload', () => {
    const dto = parseDto(serializeDto(VALID_DTO), noteKey(VALID_DTO.id));
    expect(dto).not.toBeNull();
    expect(dto!.id).toBe(VALID_DTO.id);
    expect(dto!.updatedAt).toBe(VALID_DTO.updatedAt);
    expect(dto!.deviceId).toBe('android-a7b3cd');
  });

  test('parseDto rejects id/key mismatch', () => {
    const dto = parseDto(serializeDto(VALID_DTO), 'notes/00000000-0000-0000-0000-000000000000.json');
    expect(dto).toBeNull();
  });

  test('parseDto rejects unknown higher schema version', () => {
    const json = JSON.stringify({ ...JSON.parse(serializeDto(VALID_DTO)), schemaVersion: 2 });
    expect(parseDto(json)).toBeNull();
  });

  test('parseDto rejects broken JSON and missing id', () => {
    expect(parseDto('{not json')).toBeNull();
    expect(parseDto('{"schemaVersion":1,"content":"x"}')).toBeNull();
  });

  test('parseDto is defensive about field types', () => {
    const dto = parseDto(JSON.stringify({ id: VALID_DTO.id, content: 42, color: 'PINK', extra: true }));
    expect(dto).not.toBeNull();
    expect(dto!.content).toBe('');
    expect(dto!.color).toBe('pink');
    expect(dto!.isPinnedInList).toBe(false);
  });

  test('tsValue parses ISO strings; invalid strings count as 0', () => {
    expect(tsValue('2026-10-04T07:30:00.0000000Z')).toBe(Date.parse('2026-10-04T07:30:00.000Z'));
    expect(tsValue('garbage')).toBe(0);
    expect(tsValue('')).toBe(0);
  });

  test('businessEquals ignores timestamps (anti-ping-pong) but compares business fields', () => {
    const a = { ...VALID_DTO, updatedAt: '2026-10-04T07:30:00.0000000Z' };
    const b = { ...VALID_DTO, updatedAt: '2027-01-01T00:00:00.0000000Z' };
    expect(businessEquals(a, b)).toBe(true);

    const c = { ...VALID_DTO, color: 'pink' as const };
    expect(businessEquals(a, c)).toBe(false);

    const d = { ...VALID_DTO, content: 'x\r\ny' };
    const e = { ...VALID_DTO, content: 'x\ny' };
    expect(businessEquals(d, e)).toBe(true);
  });
});
