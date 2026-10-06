// 硬删除台账对账裁决单测（对照桌面端 SYNC-HARD-DELETE-LEDGER-20261006.md §7 用例向量）
import { SyncEngine } from '../src/sync/engine';
import { noteKey, serializeDto, type NoteLike } from '../src/sync/dto';
import type { IStorageBackend, RemoteItem } from '../src/sync/backends/types';
import type { INoteRepository, RemoteApplyItem } from '../src/data/noteRepository';

// 隔离 data 层，避免测试触及 expo-sqlite（台账由用例直接注入内存实现）
jest.mock('../src/data/noteRepository', () => ({ noteRepository: {} }));
jest.mock('../src/data/hardDeleteLedger', () => ({
  hardDeleteLedger: { loadAsync: async () => new Map<string, string>() },
}));

const DEVICE_A = 'android-testaaa';
const DEVICE_B = 'android-testbbb';

const DELETED_AT = '2026-10-06T03:00:00.0000000Z';

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
  objects = new Map<string, string>();
  listItems: RemoteItem[] = [];

  async listAsync(): Promise<RemoteItem[]> {
    return this.listItems;
  }

  async getTextAsync(key: string): Promise<string | null> {
    return this.objects.get(key) ?? null;
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

function remoteItem(backend: FakeBackend, note: NoteLike): void {
  backend.listItems = [{ key: noteKey(note.id) }];
  backend.objects.set(
    noteKey(note.id),
    serializeDto({ schemaVersion: 1, iv: null, payload: null, ...note, deviceId: DEVICE_B }),
  );
}

describe('SyncEngine hard-delete ledger', () => {
  test('purged locally, remote older than deletion -> push tombstone once (idempotent)', async () => {
    const repo = new InMemoryRepo();
    const ledger = new Map<string, string>([['a1a1a1a1-0000-0000-0000-000000000000', DELETED_AT]]);
    const engine = new SyncEngine(repo, { loadAsync: async () => ledger });

    const remote = makeNote({
      id: 'a1a1a1a1-0000-0000-0000-000000000000',
      content: 'remote-legacy',
      updatedAt: '2026-10-05T00:00:00.0000000Z',
    });
    const backend = new FakeBackend();
    remoteItem(backend, remote);

    // 首轮：推墓碑覆盖云端，且绝不下行回流
    const first = await engine.runAsync(backend, DEVICE_A);
    expect(first!.uploaded).toBe(1);
    expect(first!.downloaded).toBe(0);
    expect(repo.notes.size).toBe(0);
    const pushed = JSON.parse(backend.objects.get(noteKey(remote.id))!);
    expect(pushed.isDeleted).toBe(true);
    expect(pushed.updatedAt).toBe(DELETED_AT);
    expect(pushed.content).toBe('remote-legacy'); // 保留云端现有正文

    // 次轮：云端已是同内容墓碑 -> 零传输，不乒乓
    const second = await engine.runAsync(backend, DEVICE_A);
    expect(second!.uploaded).toBe(0);
    expect(second!.downloaded).toBe(0);
  });

  test('both devices purged (remote already tombstone) -> no transfer at all', async () => {
    const repo = new InMemoryRepo();
    const id = 'b2b2b2b2-0000-0000-0000-000000000000';
    // 云端 updatedAt 与删除时刻相等也算「不新于删除」（<= 语义）
    const ledger = new Map<string, string>([[id, DELETED_AT]]);
    const engine = new SyncEngine(repo, { loadAsync: async () => ledger });

    const backend = new FakeBackend();
    remoteItem(backend, makeNote({ id, isDeleted: true, updatedAt: DELETED_AT }));

    const summary = await engine.runAsync(backend, DEVICE_A);
    expect(summary!.uploaded).toBe(0);
    expect(summary!.downloaded).toBe(0);
    expect(repo.notes.size).toBe(0);
  });

  test('remote edited after deletion -> edit wins on cloud, download vetoed locally', async () => {
    const repo = new InMemoryRepo();
    const id = 'c3c3c3c3-0000-0000-0000-000000000000';
    const ledger = new Map<string, string>([[id, DELETED_AT]]);
    const engine = new SyncEngine(repo, { loadAsync: async () => ledger });

    const remoteEdit = 'remote-edit-after-delete';
    const backend = new FakeBackend();
    remoteItem(backend, makeNote({ id, content: remoteEdit, updatedAt: '2026-10-06T09:00:00.0000000Z' }));

    const summary = await engine.runAsync(backend, DEVICE_A);
    expect(summary!.uploaded).toBe(0);
    expect(summary!.downloaded).toBe(0);
    expect(repo.notes.size).toBe(0); // 已彻底删除的便签不插回本机
    // 云端保留其他设备的合法编辑
    expect(JSON.parse(backend.objects.get(noteKey(id))!).content).toBe(remoteEdit);
  });

  test('without ledger entry (regression) -> tombstone downloads as invisible row', async () => {
    const repo = new InMemoryRepo();
    const engine = new SyncEngine(repo, { loadAsync: async () => new Map() });

    const id = 'd4d4d4d4-0000-0000-0000-000000000000';
    const backend = new FakeBackend();
    remoteItem(backend, makeNote({ id, isDeleted: true, updatedAt: '2026-10-05T00:00:00.0000000Z' }));

    const summary = await engine.runAsync(backend, DEVICE_A);
    expect(summary!.downloaded).toBe(1);
    expect(repo.notes.get(id)!.isDeleted).toBe(true);
  });

  test('note rebuilt locally after purge -> normal two-sided LWW, ledger not consulted', async () => {
    const repo = new InMemoryRepo();
    const id = 'e5e5e5e5-0000-0000-0000-000000000000';
    const ledger = new Map<string, string>([[id, DELETED_AT]]);
    const engine = new SyncEngine(repo, { loadAsync: async () => ledger });

    // 本地重建（如 JSON 导入），updatedAt 晚于云端 -> 正常上行
    repo.notes.set(id, makeNote({ id, content: 'rebuilt', updatedAt: '2026-10-06T10:00:00.0000000Z' }));
    const backend = new FakeBackend();
    remoteItem(backend, makeNote({ id, content: 'remote-old', updatedAt: '2026-10-05T00:00:00.0000000Z' }));

    const summary = await engine.runAsync(backend, DEVICE_A);
    expect(summary!.uploaded).toBe(1);
    expect(summary!.downloaded).toBe(0);
    expect(JSON.parse(backend.objects.get(noteKey(id))!).content).toBe('rebuilt');
  });
});
