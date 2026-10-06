// 同步对账与 LWW 核心算法单测（对照桌面端 SyncEngineTests.cs 关键向量）
import { SyncEngine } from '../src/sync/engine';
import { noteKey, serializeDto, type NoteLike, type SyncNoteDto } from '../src/sync/dto';
import type { IStorageBackend, RemoteItem } from '../src/sync/backends/types';
import type { INoteRepository, RemoteApplyItem } from '../src/data/noteRepository';

// 隔离 data 层，避免测试触及 expo-sqlite
jest.mock('../src/data/noteRepository', () => ({ noteRepository: {} }));

const DEVICE_A = 'android-testaaa';
const DEVICE_B = 'android-testbbb';

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
  onGetAll: (() => void) | null = null;

  async getAllAsync(): Promise<NoteLike[]> {
    // 先取快照，再触发钩子（模拟快照返回之后、下载完成之前用户编辑）
    const snapshot = [...this.notes.values()];
    this.onGetAll?.();
    return snapshot;
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
  onList: (() => void) | null = null;

  async listAsync(): Promise<RemoteItem[]> {
    this.onList?.();
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

function dtoOf(note: NoteLike, deviceId: string): SyncNoteDto {
  return { schemaVersion: 1, ...note, deviceId } as SyncNoteDto;
}

describe('SyncEngine', () => {
  test('downloads remote-only notes (tombstones included)', async () => {
    const repo = new InMemoryRepo();
    const backend = new FakeBackend();
    const remoteTombstone = makeNote({ id: 'b'.repeat(8) + '-0000-0000-0000-000000000000', isDeleted: true });
    backend.listItems = [
      { key: noteKey(remoteTombstone.id) },
      { key: noteKey(makeNote({ id: 'a'.repeat(8) + '-0000-0000-0000-000000000000' }).id) },
    ];
    for (const n of [remoteTombstone, makeNote({ id: 'a'.repeat(8) + '-0000-0000-0000-000000000000' })]) {
      backend.objects.set(noteKey(n.id), serializeDto(dtoOf(n, DEVICE_B)));
    }

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A);
    expect(summary).not.toBeNull();
    expect(summary!.downloaded).toBe(2);
    expect(summary!.uploaded).toBe(0);
    expect(repo.notes.size).toBe(2);
    expect([...repo.notes.values()].some((n) => n.isDeleted)).toBe(true);
  });

  test('uploads local-only notes including local tombstones', async () => {
    const repo = new InMemoryRepo();
    const localNew = makeNote({ id: 'c'.repeat(8) + '-0000-0000-0000-000000000000' });
    const localTomb = makeNote({ id: 'd'.repeat(8) + '-0000-0000-0000-000000000000', isDeleted: true });
    repo.notes.set(localNew.id, localNew);
    repo.notes.set(localTomb.id, localTomb);

    const backend = new FakeBackend();
    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A);

    expect(summary!.uploaded).toBe(2);
    expect(JSON.parse(backend.objects.get(noteKey(localNew.id))! as string).id).toBe(localNew.id);
    expect(JSON.parse(backend.objects.get(noteKey(localTomb.id))! as string).isDeleted).toBe(true);
  });

  test('LWW: newer local wins (upload), newer remote wins (download)', async () => {
    const repo = new InMemoryRepo();
    const idOld = 'e'.repeat(8) + '-0000-0000-0000-000000000000';
    const idNew = 'f'.repeat(8) + '-0000-0000-0000-000000000000';

    repo.notes.set(idOld, makeNote({ id: idOld, content: 'local-old', updatedAt: '2026-10-01T00:00:00.0000000Z' }));
    repo.notes.set(idNew, makeNote({ id: idNew, content: 'local-newer', updatedAt: '2026-10-05T00:00:00.0000000Z' }));

    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(idOld) }, { key: noteKey(idNew) }];
    backend.objects.set(
      noteKey(idOld),
      serializeDto(dtoOf(makeNote({ id: idOld, content: 'remote-newer', updatedAt: '2026-10-03T00:00:00.0000000Z' }), DEVICE_B)),
    );
    backend.objects.set(
      noteKey(idNew),
      serializeDto(dtoOf(makeNote({ id: idNew, content: 'remote-older', updatedAt: '2026-10-04T00:00:00.0000000Z' }), DEVICE_B)),
    );

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A);

    // idOld: 远端较新 -> 下行；idNew: 本地较新 -> 上行
    expect(summary!.downloaded).toBe(1);
    expect(summary!.uploaded).toBe(1);
    expect(repo.notes.get(idOld)!.content).toBe('remote-newer');
    expect(JSON.parse(backend.objects.get(noteKey(idNew))! as string).content).toBe('local-newer');
  });

  test('LWW: equal timestamps — local wins deterministically', async () => {
    const repo = new InMemoryRepo();
    const id = 'a1b2c3d4-0000-0000-0000-000000000000';
    const ts = '2026-10-04T07:30:00.0000000Z';
    repo.notes.set(id, makeNote({ id, content: 'local', updatedAt: ts }));

    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(id) }];
    backend.objects.set(noteKey(id), serializeDto(dtoOf(makeNote({ id, content: 'remote', updatedAt: ts }), DEVICE_B)));

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A);
    expect(summary!.uploaded).toBe(1);
    expect(summary!.downloaded).toBe(0);
    expect(repo.notes.get(id)!.content).toBe('local');
  });

  test('anti-ping-pong: same business content but different timestamps transfers nothing', async () => {
    const repo = new InMemoryRepo();
    const id = 'b2b2b2b2-0000-0000-0000-000000000000';
    repo.notes.set(id, makeNote({ id, content: 'same\ncontent', updatedAt: '2026-10-04T10:00:00.0000000Z' }));

    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(id) }];
    backend.objects.set(
      noteKey(id),
      serializeDto(dtoOf(makeNote({ id, content: 'same\r\ncontent', updatedAt: '2026-10-04T09:00:00.0000000Z' }), DEVICE_B)),
    );

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A);
    expect(summary!.uploaded).toBe(0);
    expect(summary!.downloaded).toBe(0);
    expect(repo.notes.get(id)!.updatedAt).toBe('2026-10-04T10:00:00.0000000Z');
  });

  test('downstream guard skips notes locally modified during the reconciliation window', async () => {
    const repo = new InMemoryRepo();
    const id = 'c3c3c3c3-0000-0000-0000-000000000000';
    repo.notes.set(id, makeNote({ id, content: 'snapshot', updatedAt: '2026-10-02T00:00:00.0000000Z' }));

    // 模拟「读取快照 -> 下载完成」窗口内用户编辑了这条便签
    repo.onGetAll = () => {
      repo.onGetAll = null;
      repo.notes.set(id, makeNote({ id, content: 'user edit', updatedAt: '2026-10-03T12:00:00.0000000Z' }));
    };

    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(id) }];
    backend.objects.set(
      noteKey(id),
      serializeDto(dtoOf(makeNote({ id, content: 'remote', updatedAt: '2026-10-03T00:00:00.0000000Z' }), DEVICE_B)),
    );

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A);
    expect(summary!.guardedSkipped).toBe(1);
    expect(summary!.downloaded).toBe(0);
    expect(repo.notes.get(id)!.content).toBe('user edit');
  });

  test('circuit breaker: all downloads fail -> abort, never treat remote as empty', async () => {
    const repo = new InMemoryRepo();
    const id = 'd4d4d4d4-0000-0000-0000-000000000000';
    repo.notes.set(id, makeNote({ id, content: 'local-precious', updatedAt: '2026-10-02T00:00:00.0000000Z' }));

    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(id) }];
    backend.objects.set(noteKey(id), new Error('network down'));

    await expect(new SyncEngine(repo).runAsync(backend, DEVICE_A)).rejects.toThrow('远端下载全部失败');
    // 本地数据原封不动，未执行任何上传
    expect(repo.notes.get(id)!.content).toBe('local-precious');
    expect(backend.objects.get(noteKey(id))! instanceof Error).toBe(true);
  });

  test('invalid remote files are isolated, healthy ones still sync', async () => {
    const repo = new InMemoryRepo();
    const goodId = 'e5e5e5e5-0000-0000-0000-000000000000';
    const badKey1 = 'notes/deadbeef-0000-0000-0000-00000000000x.json';
    const badKey2 = 'notes/aaaa0000-0000-0000-0000-000000000000.json';

    const backend = new FakeBackend();
    backend.listItems = [{ key: noteKey(goodId) }, { key: badKey1 }, { key: badKey2 }];
    backend.objects.set(noteKey(goodId), serializeDto(dtoOf(makeNote({ id: goodId, content: 'ok' }), DEVICE_B)));
    backend.objects.set(badKey1, '{ broken json');
    backend.objects.set(badKey2, serializeDto(dtoOf(makeNote({ id: 'bbbb0000-0000-0000-0000-000000000000' }), DEVICE_B)));

    const summary = await new SyncEngine(repo).runAsync(backend, DEVICE_A);
    expect(summary!.skippedInvalid).toBe(2);
    expect(summary!.downloaded).toBe(1);
  });

  test('single flight: concurrent run returns null instead of queueing', async () => {
    const repo = new InMemoryRepo();

    const gate = { resolve: () => {} };
    let release!: () => void;
    const blocked = new Promise<void>((r) => (release = r));
    gate.resolve = release;

    const backend = new FakeBackend();
    backend.onList = () => {
      // 第一轮停在 list 阶段
      void blocked;
      throw new Error('stop');
    };

    const engine = new SyncEngine(repo);
    const first = engine.runAsync(backend, DEVICE_A).catch(() => 'failed');
    const second = await engine.runAsync(backend, DEVICE_A);
    expect(second).toBeNull();
    release();
    await first;
  });
});
