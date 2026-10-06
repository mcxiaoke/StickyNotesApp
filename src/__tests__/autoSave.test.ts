// 自动保存协调器单测：防抖落盘、失败后自动重试、重试次数上限、以及 flush 的幂等与刷盘时机。
import { AutoSaveCoordinator } from '../src/services/autoSave';

jest.mock('../src/services/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('AutoSaveCoordinator', () => {
  test('输入停止 500ms 后落盘，期间多次输入只落盘最后一次', async () => {
    const save = jest.fn(async () => {});
    const coordinator = new AutoSaveCoordinator(save);

    coordinator.schedule('n1', 'a');
    jest.advanceTimersByTime(200);
    coordinator.schedule('n1', 'ab');
    expect(save).not.toHaveBeenCalled();

    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('n1', 'ab');
  });

  test('flush 立即落盘，无需等待防抖', async () => {
    const save = jest.fn(async () => {});
    const coordinator = new AutoSaveCoordinator(save);

    coordinator.schedule('n1', 'hello');
    await coordinator.flush();

    expect(save).toHaveBeenCalledWith('n1', 'hello');
    // 定时器已被 flush 取消：不应再触发第二次保存
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('无挂起内容时 flush 立即 resolve 且不调用保存', async () => {
    const save = jest.fn(async () => {});
    const coordinator = new AutoSaveCoordinator(save);

    await coordinator.flush();
    expect(save).not.toHaveBeenCalled();
  });

  test('保存失败后自动重试，成功后不再重试', async () => {
    const save = jest
      .fn<Promise<void>, [string, string]>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    const coordinator = new AutoSaveCoordinator(save);

    coordinator.schedule('n1', 'draft');
    await jest.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);

    // 失败后 2 秒自动重试，内容仍是同一份 pending
    await jest.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('n1', 'draft');

    // 已成功，重试预算清零，不再产生额外调用
    await jest.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(2);
  });

  test('持续失败时最多自动重试 MAX_RETRIES 次，随后停止（内容仍留在 pending）', async () => {
    const save = jest.fn<Promise<void>, [string, string]>().mockRejectedValue(new Error('boom'));
    const coordinator = new AutoSaveCoordinator(save);

    coordinator.schedule('n1', 'draft');
    await jest.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(4); // 1 次首发 + 3 次重试

    // 放弃自动重试后不再空转
    await jest.advanceTimersByTimeAsync(10_000);
    expect(save).toHaveBeenCalledTimes(4);

    // 但内容没丢：下一次 flush（返回/进后台路径）仍会再试一次
    const flushed = coordinator.flush();
    await jest.advanceTimersByTimeAsync(1);
    await flushed;
    expect(save).toHaveBeenCalledTimes(5);
  });
});
