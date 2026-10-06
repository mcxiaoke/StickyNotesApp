// 加密同步链路单测：上行密文化、下行解密回填、口令探针守卫、伪密文隔离、防乒乓不变。
import { createVerifierJson } from '../src/sync/authVerifier';
import { unwrapMagicPayload } from '../src/sync/crypto/cryptoHelper';
import {
  dtoFromNote,
  dtoFromNoteEncrypted,
  noteKey,
  parseDto,
  serializeDto,
  type NoteLike,
  type SyncNoteDto,
} from '../src/sync/dto';
import { SyncEngine } from '../src/sync/engine';
import type { IStorageBackend, RemoteItem } from '../src/sync/backends/types';
import type { INoteRepository, RemoteApplyItem } from '../src/data/noteRepository';

jest.mock('../src/data/noteRepository', () => ({ noteRepository: {} }));
jest.mock('../src/data/hardDeleteLedger', () => ({
  hardDeleteLedger: { loadAsync: async () => new Map<string, string>() },
}));

const DEVICE_A = 'android-testaaa';
const DEVICE_B = 'android-testbbb';
const SECRET = 'StickyNotes#UnitTest!VaultSecret';
const FIXED_IV = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

function makeNote(partial: Partial<NoteLike> & { id: string }): NoteLike {
  return {
    content: 'content-' + partial.id,
    color: 'yellow',
    isPinnedInList: false,
    alwaysOnTop: false,
    isDeleted: false,
    createdAt: '2026-10-01T00:00:00.0000000Z',
    updatedAt: '2026-10-02T00:00:00.0000000Z',
    ...partial,
  };
}

class InMemoryRepo implements INoteRepository {
  notes = new Map<string, NoteLike>();

  async getAllAsync(): Promise<NoteLike[]> {
    return [...this.notes.values()];
  }

  async applyRemoteBatchAsync(items: RemoteApplyItem[]): Promise<{ applied: number; guardedSkipped: number }> {
    let applied = 0;
    let guarded = 0;
    for (const item of items) {
      const current = this.notes.get(item.note.id);
      if (!current) {
        this.notes.set(item.note.id, { ...item.note });
        applied++;
      } else if (item.snapshotUpdatedAt !== null && current.updatedAt === item.snapshotUpdatedAt) {
        this.notes.set(item.note.id, { ...item.note });
        applied++;
      } else {
        guarded++;
      }
    }
    return { applied, guardedSkipped: guarded };
  }
}

class FakeBackend implements IStorageBackend {
  objects = new Map<string, string | Error>();
  listItems: RemoteItem[] = [];

  async listAsync(): Promise<RemoteItem[]> {
    return this.listItems;
  }

  async getTextAsync(key: string): Promise<string | null> {
    const v = this.objects.get(key);
    if (v instanceof Error) throw v;
    return v ?? null;
  }

  async putTextAsync(key: string, content: string): Promise<void> {
    this.objects.set(key, content);
  }

  async deleteAsync(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async testAsync(): Promise<void> {}

  dispose(): void {}
}

const ID_A = 'a1a1a1a1-0000-0000-0000-000000000000';

describe('SyncEngine 加密上行', () => {
  test('开启加密后上行对象为 iv + payload，不含 content，且探针自举创建', async () => {
    const repo = new InMemoryRepo();
    const note = makeNote({ id: ID_A, content: '机密内容 📝\n第二行' });
    repo.notes.set(ID_A, note);

    const backend = new FakeBackend();
    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A, {
      enableEncryption: true,
      secret: SECRET,
    });

    expect(summary!.uploaded).toBe(1);
    const raw = backend.objects.get(noteKey(ID_A));
    expect(typeof raw).toBe('string');
    const parsed = JSON.parse(raw as string) as Record<string, unknown>;

    expect('content' in parsed).toBe(false);
    expect(typeof parsed['iv']).toBe('string');
    expect(typeof parsed['payload']).toBe('string');
    // 解密后可还原原文（魔数剥离）
    expect(unwrapMagicPayload(parsed['iv'] as string, parsed['payload'] as string, SECRET)).toBe(
      '机密内容 📝\n第二行',
    );

    // 探针在首轮自动创建
    const verifier = backend.objects.get('.auth_verifier');
    expect(typeof verifier).toBe('string');
    expect(JSON.parse(verifier as string)).toMatchObject({ version: 1 });
  });

  test('加密关闭时仍写入明文 content，不产生 iv / payload', async () => {
    const repo = new InMemoryRepo();
    repo.notes.set(ID_A, makeNote({ id: ID_A, content: 'plain text' }));
    const backend = new FakeBackend();

    await new SyncEngine(repo).runAsync(backend, DEVICE_A);
    const parsed = JSON.parse(backend.objects.get(noteKey(ID_A)) as string) as Record<string, unknown>;
    expect(parsed['content']).toBe('plain text');
    expect('iv' in parsed).toBe(false);
    expect('payload' in parsed).toBe(false);
    expect(backend.objects.has('.auth_verifier')).toBe(false);
  });
});

describe('SyncEngine 加密下行', () => {
  test('远端密文解密回填明文并入库', async () => {
    const repo = new InMemoryRepo();
    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(ID_A) }];
    backend.objects.set('.auth_verifier', createVerifierJson(SECRET));
    backend.objects.set(
      noteKey(ID_A),
      serializeDto(
        dtoFromNoteEncrypted(makeNote({ id: ID_A, content: '远端机密 🚀' }), DEVICE_B, SECRET, FIXED_IV),
      ),
    );

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A, {
      enableEncryption: true,
      secret: SECRET,
    });

    expect(summary!.downloaded).toBe(1);
    expect(summary!.skippedInvalid).toBe(0);
    expect(repo.notes.get(ID_A)!.content).toBe('远端机密 🚀');
  });

  test('未开启加密时遇到密文文件按坏数据跳过，绝不写入乱码', async () => {
    const repo = new InMemoryRepo();
    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(ID_A) }];
    backend.objects.set(
      noteKey(ID_A),
      serializeDto(dtoFromNoteEncrypted(makeNote({ id: ID_A, content: 'secret' }), DEVICE_B, SECRET, FIXED_IV)),
    );

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A);
    expect(summary!.skippedInvalid).toBe(1);
    expect(summary!.downloaded).toBe(0);
    expect(repo.notes.size).toBe(0);
  });

  test('口令不符时该条跳过（单条失败不中断整轮）', async () => {
    const repo = new InMemoryRepo();
    const backend = new FakeBackend();
    const goodId = 'b2b2b2b2-0000-0000-0000-000000000000';
    backend.listItems = [{ key: noteKey(ID_A) }, { key: noteKey(goodId) }];
    backend.objects.set('.auth_verifier', createVerifierJson(SECRET));
    // 该条用另一个密钥加密，解密必失败
    backend.objects.set(
      noteKey(ID_A),
      serializeDto(dtoFromNoteEncrypted(makeNote({ id: ID_A, content: 'x' }), DEVICE_B, 'another-secret', FIXED_IV)),
    );
    backend.objects.set(
      noteKey(goodId),
      serializeDto(dtoFromNoteEncrypted(makeNote({ id: goodId, content: 'ok' }), DEVICE_B, SECRET, FIXED_IV)),
    );

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A, {
      enableEncryption: true,
      secret: SECRET,
    });
    expect(summary!.skippedInvalid).toBe(1);
    expect(summary!.downloaded).toBe(1);
    expect(repo.notes.get(goodId)!.content).toBe('ok');
    expect(repo.notes.has(ID_A)).toBe(false);
  });
});

describe('SyncEngine 口令探针守卫', () => {
  test('远端探针密钥不符时整轮中止，且本地与远端均未被改动', async () => {
    const repo = new InMemoryRepo();
    repo.notes.set(ID_A, makeNote({ id: ID_A, content: 'local-precious' }));
    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(ID_A) }];
    backend.objects.set('.auth_verifier', createVerifierJson('a-different-secret'));

    await expect(
      new SyncEngine(repo).runAsync(backend, DEVICE_A, { enableEncryption: true, secret: SECRET }),
    ).rejects.toThrow(/口令校验失败/);

    expect(repo.notes.get(ID_A)!.content).toBe('local-precious');
    // 未上传任何便签（objects 内只有探针）
    expect(backend.objects.has(noteKey(ID_A))).toBe(false);
  });

  test('启用加密但缺少口令时直接抛错', async () => {
    const repo = new InMemoryRepo();
    const backend = new FakeBackend();
    await expect(
      new SyncEngine(repo).runAsync(backend, DEVICE_A, { enableEncryption: true }),
    ).rejects.toThrow(/缺少保险箱口令/);
  });
});

describe('加密模式下的防乒乓与对账一致性', () => {
  test('远端密文解密后与本地明文业务等价时不产生任何传输', async () => {
    const repo = new InMemoryRepo();
    const ts = '2026-10-04T07:30:00.0000000Z';
    repo.notes.set(ID_A, makeNote({ id: ID_A, content: 'same\r\ncontent', updatedAt: ts }));

    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(ID_A) }];
    backend.objects.set('.auth_verifier', createVerifierJson(SECRET));
    backend.objects.set(
      noteKey(ID_A),
      serializeDto(
        dtoFromNoteEncrypted(makeNote({ id: ID_A, content: 'same\ncontent', updatedAt: ts }), DEVICE_B, SECRET, FIXED_IV),
      ),
    );

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A, {
      enableEncryption: true,
      secret: SECRET,
    });
    expect(summary!.uploaded).toBe(0);
    expect(summary!.downloaded).toBe(0);
  });

  test('解密后的明文参与 LWW：远端更新则下行覆盖本地', async () => {
    const repo = new InMemoryRepo();
    repo.notes.set(ID_A, makeNote({ id: ID_A, content: 'local-old', updatedAt: '2026-10-01T00:00:00.0000000Z' }));

    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(ID_A) }];
    backend.objects.set('.auth_verifier', createVerifierJson(SECRET));
    backend.objects.set(
      noteKey(ID_A),
      serializeDto(
        dtoFromNoteEncrypted(
          makeNote({ id: ID_A, content: 'remote-newer', updatedAt: '2026-10-05T00:00:00.0000000Z' }),
          DEVICE_B,
          SECRET,
          FIXED_IV,
        ),
      ),
    );

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A, {
      enableEncryption: true,
      secret: SECRET,
    });
    expect(summary!.downloaded).toBe(1);
    expect(repo.notes.get(ID_A)!.content).toBe('remote-newer');
  });
});

describe('DTO 明密文互斥校验', () => {
  test('密文 DTO 序列化后不含 content，解析后 content 为 null', () => {
    const dto: SyncNoteDto = dtoFromNoteEncrypted(makeNote({ id: ID_A }), DEVICE_B, SECRET, FIXED_IV);
    const json = serializeDto(dto);
    expect(json).not.toContain('"content"');

    const parsed = parseDto(json, noteKey(ID_A));
    expect(parsed).not.toBeNull();
    expect(parsed!.content).toBeNull();
    expect(parsed!.iv).toBeTruthy();
    expect(parsed!.payload).toBeTruthy();
  });

  test('同时含 content 与 iv/payload 的文件被判非法', () => {
    const base = JSON.parse(serializeDto(dtoFromNote(makeNote({ id: ID_A }), DEVICE_B))) as Record<string, unknown>;
    const mixed = JSON.stringify({ ...base, iv: 'AAECAwQFBgcICQoLDA0ODw==', payload: 'AAAA' });
    expect(parseDto(mixed, noteKey(ID_A))).toBeNull();
  });

  test('iv 与 payload 不成对的文件被判非法', () => {
    const base = JSON.parse(serializeDto(dtoFromNote(makeNote({ id: ID_A }), DEVICE_B))) as Record<string, unknown>;
    delete base['content'];
    const onlyIv = JSON.stringify({ ...base, iv: 'AAECAwQFBgcICQoLDA0ODw==' });
    expect(parseDto(onlyIv, noteKey(ID_A))).toBeNull();
  });
});
