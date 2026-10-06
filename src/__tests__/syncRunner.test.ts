// 同步执行入口单测：模块级单飞（并发轮次合并为同一轮）与「提前返回不污染 UI 状态」。
// 引擎本身被 mock：这里验证的是 syncRunner 的编排，而非对账算法（后者见 syncEngine.test.ts）。
import type { SyncRoundSummary } from '../src/sync/engine';
import type { IStorageBackend } from '../src/sync/backends/types';
import { createBackendAsync } from '../src/sync/backendFactory';
import { loadSyncSettings, type SyncSettings } from '../src/sync/settings';
import { performSyncRound, setSyncStateListener } from '../src/sync/syncRunner';

const mockRunAsync = jest.fn();

jest.mock('../src/sync/engine', () => ({
  SyncEngine: jest.fn(() => ({ runAsync: mockRunAsync })),
}));
jest.mock('../src/data/db', () => ({ kvGet: jest.fn(() => null), kvSet: jest.fn() }));
jest.mock('../src/services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../src/services/deviceId', () => ({ getDeviceId: () => 'test-device' }));
jest.mock('../src/sync/crypto/vaultSecret', () => ({
  getVaultSecret: () => 'vault-secret',
  isUsingLocalSecret: () => true,
}));
jest.mock('../src/sync/settings', () => ({ loadSyncSettings: jest.fn() }));
jest.mock('../src/sync/backendFactory', () => ({ createBackendAsync: jest.fn() }));

const { DEFAULT_SYNC_SETTINGS } = jest.requireActual('../src/sync/settings') as typeof import('../src/sync/settings');

const settingsMock = loadSyncSettings as jest.MockedFunction<typeof loadSyncSettings>;
const createBackendMock = createBackendAsync as jest.MockedFunction<typeof createBackendAsync>;

const SUMMARY: SyncRoundSummary = {
  listed: 3,
  downloaded: 1,
  uploaded: 2,
  skippedInvalid: 0,
  guardedSkipped: 0,
  appliedIds: [],
};

class FakeBackend implements IStorageBackend {
  listCalls = 0;
  disposed = 0;

  async listAsync() {
    this.listCalls++;
    return [];
  }
  async getTextAsync() {
    return null;
  }
  async putTextAsync() {}
  async deleteAsync() {}
  async testAsync() {}
  dispose() {
    this.disposed++;
  }
}

function enabledSettings(): SyncSettings {
  return { ...DEFAULT_SYNC_SETTINGS, enabled: true };
}

beforeEach(() => {
  jest.clearAllMocks();
  setSyncStateListener(null);
});

describe('performSyncRound 模块级单飞', () => {
  test('并发两轮合并为同一轮，不复用也不会各自起一轮', async () => {
    settingsMock.mockReturnValue(enabledSettings());
    const backend = new FakeBackend();
    createBackendMock.mockResolvedValue(backend);
    let resolveRound!: (value: SyncRoundSummary) => void;
    const gate = new Promise<SyncRoundSummary>((resolve) => {
      resolveRound = resolve;
    });
    mockRunAsync.mockReturnValue(gate);

    const events: string[] = [];
    setSyncStateListener((event) => events.push(event.type));

    const first = performSyncRound('debounce');
    const second = performSyncRound('manual');
    // 同一 Promise：调用方拿到的都是正在跑的那一轮
    expect(second).toBe(first);

    resolveRound(SUMMARY);
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(SUMMARY);
    expect(b).toBe(SUMMARY);
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    // 整个并发窗口只装配了一个后端实例（引擎被 mock，故以工厂调用次数与 dispose 次数为证）
    expect(createBackendMock).toHaveBeenCalledTimes(1);
    expect(backend.disposed).toBe(1);
    expect(events).toEqual(['start', 'success', 'end']);
  });

  test('一轮结束后单飞释放，后续轮次照常执行', async () => {
    settingsMock.mockReturnValue(enabledSettings());
    createBackendMock.mockResolvedValue(new FakeBackend());
    mockRunAsync.mockResolvedValue(SUMMARY);

    await performSyncRound('manual');
    await performSyncRound('manual');

    expect(mockRunAsync).toHaveBeenCalledTimes(2);
  });

  test('未启用同步：直接返回 null 且不广播任何事件', async () => {
    settingsMock.mockReturnValue({ ...DEFAULT_SYNC_SETTINGS, enabled: false });
    const events: string[] = [];
    setSyncStateListener((event) => events.push(event.type));

    await expect(performSyncRound('manual')).resolves.toBeNull();
    expect(createBackendMock).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  test('配置不完整（后端构造失败）：返回 null 且不广播 start/end', async () => {
    settingsMock.mockReturnValue(enabledSettings());
    createBackendMock.mockResolvedValue(null);
    const events: string[] = [];
    setSyncStateListener((event) => events.push(event.type));

    await expect(performSyncRound('manual')).resolves.toBeNull();
    expect(mockRunAsync).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
