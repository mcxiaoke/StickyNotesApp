// 同步状态机单测：inFlight 守卫、终态回落 idle，以及「轮次提前返回不把状态永久留在 syncing」。
import { performSyncRound, setSyncStateListener } from '../src/sync/syncRunner';
import { loadSyncSettings } from '../src/sync/settings';

jest.mock('../src/sync/syncRunner', () => ({
  performSyncRound: jest.fn(),
  setSyncStateListener: jest.fn(),
  getLastSyncTime: jest.fn(() => null),
  getLastSyncStats: jest.fn(() => null),
}));
jest.mock('../src/sync/settings', () => ({ loadSyncSettings: jest.fn() }));
jest.mock('../src/services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// eslint-disable-next-line import/first
import { syncStore } from '../src/stores/syncStore';

const performMock = performSyncRound as jest.MockedFunction<typeof performSyncRound>;
const listenerMock = setSyncStateListener as jest.MockedFunction<typeof setSyncStateListener>;
const settingsMock = loadSyncSettings as jest.MockedFunction<typeof loadSyncSettings>;

type Emitted = (event: { type: 'start' | 'end' | 'success' | 'error'; at?: string; stats?: unknown; message?: string }) => void;

const STATS = { at: '2026-10-06T03:00:00.000Z', listed: 1, uploaded: 1, downloaded: 0 };

// syncStore 在 import 时即注册监听器，需在 clearAllMocks 之前拿到该回调
const emit = listenerMock.mock.calls[0][0] as Emitted;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  settingsMock.mockReturnValue({
    enabled: true,
    enableEncryption: false,
    backendType: 'webdav',
    webdav: { serverUrl: 'https://dav.example.com/', username: 'u', allowHttp: false },
    s3: { endpoint: '', bucket: '', basePrefix: '', accessKeyId: '' },
    backgroundSyncMinutes: 15,
  });
  syncStore.setState({ status: 'idle', inFlight: false, lastError: null });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('syncStore 状态机', () => {
  test('轮次进行中 inFlight 为真，结束后终态在 8 秒后回落 idle', () => {
    emit({ type: 'start' });
    expect(syncStore.getState().inFlight).toBe(true);
    expect(syncStore.getState().status).toBe('syncing');

    emit({ type: 'success', at: STATS.at, stats: STATS });
    emit({ type: 'end' });
    expect(syncStore.getState().inFlight).toBe(false);
    expect(syncStore.getState().status).toBe('success');

    jest.advanceTimersByTime(8_000);
    expect(syncStore.getState().status).toBe('idle');
  });

  test('错误终态同样回落 idle，但 lastError 保留供诊断', () => {
    emit({ type: 'start' });
    emit({ type: 'error', message: 'boom' });
    emit({ type: 'end' });

    expect(syncStore.getState().status).toBe('error');
    expect(syncStore.getState().lastError).toBe('boom');

    jest.advanceTimersByTime(8_000);
    expect(syncStore.getState().status).toBe('idle');
    expect(syncStore.getState().lastError).toBe('boom');
  });

  test('runNow 在已有轮次进行中时被拒绝，且不改动状态', async () => {
    emit({ type: 'start' });

    await expect(syncStore.getState().runNow()).resolves.toBe(false);
    expect(performMock).not.toHaveBeenCalled();
    expect(syncStore.getState().status).toBe('syncing');
  });

  test('runNow 正常完成一轮返回 true', async () => {
    performMock.mockResolvedValue({ listed: 0, downloaded: 0, uploaded: 0, skippedInvalid: 0, guardedSkipped: 0, appliedIds: [] });

    await expect(syncStore.getState().runNow()).resolves.toBe(true);
    expect(syncStore.getState().inFlight).toBe(false);
  });

  test('runNow 遇到提前返回（配置不完整）时不会永久卡在 syncing', async () => {
    performMock.mockResolvedValue(null);

    await expect(syncStore.getState().runNow()).resolves.toBe(false);
    expect(syncStore.getState().status).toBe('idle');
    expect(syncStore.getState().inFlight).toBe(false);
  });
});
