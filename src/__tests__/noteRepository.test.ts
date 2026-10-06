// 仓储层单测：applyRemoteBatchAsync 的下行守卫三态与批量载入优化。
// 用假数据库替换 expo-sqlite（工厂内只用内建类型，避免 jest.mock 提升规则的限制）：
// 既能验证守卫语义，也用「getFirstSync 绝不被调用」锁住 N+1 不回退。
import type { RemoteApplyItem } from '../src/data/noteRepository';

interface MockRow {
  id: string;
  content: string;
  color: string;
  is_pinned_in_list: number;
  always_on_top: number;
  is_deleted: number;
  created_at: string;
  updated_at: string;
}

jest.mock('../src/data/db', () => {
  class FakeDb {
    rows = new Map<string, Record<string, unknown>>();
    getAllSyncCalls: string[] = [];
    getFirstSyncCalls = 0;

    getAllSync<T>(sql: string): T[] {
      this.getAllSyncCalls.push(sql);
      const values = [...this.rows.values()];
      if (/select id, updated_at from notes/i.test(sql)) {
        return values.map((r) => ({ id: r['id'], updated_at: r['updated_at'] })) as T[];
      }
      if (/select \* from notes/i.test(sql)) {
        return values as T[];
      }
      throw new Error(`unexpected getAllSync: ${sql}`);
    }

    getFirstSync<T>(): T {
      this.getFirstSyncCalls++;
      throw new Error('getFirstSync 不应被调用：下行应用必须一次载入 id→updated_at 映射');
    }

    runSync(sql: string, ...params: unknown[]): void {
      const head = sql.trim().split(/\s+/).slice(0, 2).join(' ').toUpperCase();
      if (head === 'INSERT INTO') {
        const [id, content, color, pinned, top, deleted, createdAt, updatedAt] = params as string[];
        this.rows.set(id, {
          id,
          content,
          color,
          is_pinned_in_list: Number(pinned),
          always_on_top: Number(top),
          is_deleted: Number(deleted),
          created_at: createdAt,
          updated_at: updatedAt,
        });
        return;
      }
      if (head === 'UPDATE NOTES') {
        const [content, color, pinned, top, deleted, updatedAt, id] = params as string[];
        const row = this.rows.get(id);
        if (!row) throw new Error(`UPDATE 目标行不存在: ${id}`);
        Object.assign(row, {
          content,
          color,
          is_pinned_in_list: Number(pinned),
          always_on_top: Number(top),
          is_deleted: Number(deleted),
          updated_at: updatedAt,
        });
        return;
      }
      throw new Error(`unexpected runSync: ${sql}`);
    }

    withTransactionSync(fn: () => void): void {
      fn();
    }
  }

  const instance = new FakeDb();
  return { __fakeDb: instance, openAppDatabase: () => instance, getDatabase: () => instance };
});

// eslint-disable-next-line import/first
import { noteRepository } from '../src/data/noteRepository';

const fakeDb = (
  jest.requireMock('../src/data/db') as unknown as {
    __fakeDb: { rows: Map<string, MockRow>; getAllSyncCalls: string[]; getFirstSyncCalls: number };
  }
).__fakeDb;

const T1 = '2026-10-01T00:00:00.0000000Z';
const T2 = '2026-10-02T00:00:00.0000000Z';
const T3 = '2026-10-03T00:00:00.0000000Z';

function row(partial: Partial<MockRow> & { id: string }): MockRow {
  return {
    content: 'local',
    color: 'yellow',
    is_pinned_in_list: 0,
    always_on_top: 0,
    is_deleted: 0,
    created_at: T1,
    updated_at: T1,
    ...partial,
  };
}

function item(
  partial: Partial<RemoteApplyItem['note']> & { id: string },
  snapshotUpdatedAt: string | null,
): RemoteApplyItem {
  return {
    note: {
      content: 'remote',
      color: 'yellow',
      isPinnedInList: false,
      alwaysOnTop: false,
      isDeleted: false,
      createdAt: T1,
      updatedAt: T2,
      ...partial,
    },
    snapshotUpdatedAt,
  };
}

beforeEach(() => {
  fakeDb.rows.clear();
  fakeDb.getAllSyncCalls.length = 0;
  fakeDb.getFirstSyncCalls = 0;
});

describe('applyRemoteBatchAsync 下行守卫', () => {
  test('本地无此行 → 强制插入（含墓碑）', async () => {
    const result = await noteRepository.applyRemoteBatchAsync([
      item({ id: 'a', content: 'from-remote', isDeleted: true }, null),
    ]);

    expect(result).toEqual({ applied: 1, guardedSkipped: 0 });
    expect(fakeDb.rows.get('a')).toMatchObject({ content: 'from-remote', is_deleted: 1, updated_at: T2 });
  });

  test('快照与当前行版本一致 → 覆盖', async () => {
    fakeDb.rows.set('b', row({ id: 'b', updated_at: T1 }));

    const result = await noteRepository.applyRemoteBatchAsync([
      item({ id: 'b', content: 'overwritten' }, T1),
    ]);

    expect(result).toEqual({ applied: 1, guardedSkipped: 0 });
    expect(fakeDb.rows.get('b')).toMatchObject({ content: 'overwritten', updated_at: T2 });
  });

  test('快照后被本地编辑（版本不一致）→ 跳过，等下一轮收敛', async () => {
    fakeDb.rows.set('c', row({ id: 'c', content: 'local-edit', updated_at: T3 }));

    const result = await noteRepository.applyRemoteBatchAsync([
      item({ id: 'c', content: 'stale-remote' }, T1),
    ]);

    expect(result).toEqual({ applied: 0, guardedSkipped: 1 });
    expect(fakeDb.rows.get('c')).toMatchObject({ content: 'local-edit', updated_at: T3 });
  });

  test('一次载入版本映射：批量应用不产生逐行查询', async () => {
    fakeDb.rows.set('d', row({ id: 'd', updated_at: T1 }));

    const result = await noteRepository.applyRemoteBatchAsync([
      item({ id: 'd', content: 'x' }, T1),
      item({ id: 'f', content: 'y' }, null),
    ]);

    expect(result).toEqual({ applied: 2, guardedSkipped: 0 });
    expect(fakeDb.getFirstSyncCalls).toBe(0);
    expect(fakeDb.getAllSyncCalls).toHaveLength(1);
  });
});
