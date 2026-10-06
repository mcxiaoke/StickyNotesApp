// logger 单元测试：环形缓冲上限、订阅通知、快照引用稳定、describeError cause 链
import { describeError, logger } from '../src/services/logger';

describe('logger 环形缓冲', () => {
  it('超过上限时丢弃最旧条目', () => {
    for (let i = 0; i < 600; i++) {
      logger.info('test', `msg-${i}`);
    }
    expect(logger.count()).toBe(500);
    const entries = logger.getEntries();
    // 新在前：最新一条是 msg-599，最旧一条是 msg-100
    expect(entries[0].message).toBe('msg-599');
    expect(entries[entries.length - 1].message).toBe('msg-100');
  });

  it('getLines 与 getEntries 均为新在前', () => {
    const lines = logger.getLines();
    expect(lines.length).toBe(500);
    expect(lines[0]).toContain('msg-599');
  });
});

describe('logger 订阅', () => {
  it('push 与 clear 后通知订阅者，退订后不再通知', () => {
    let notified = 0;
    const unsubscribe = logger.subscribe(() => {
      notified++;
    });

    logger.info('test', 'subscribe-hit');
    expect(notified).toBe(1);

    logger.clear();
    expect(notified).toBe(2);
    expect(logger.count()).toBe(0);

    unsubscribe();
    logger.info('test', 'after-unsubscribe');
    expect(notified).toBe(2);
  });

  it('快照引用在两次变更间保持稳定（useSyncExternalStore 依赖）', () => {
    logger.clear();
    const before = logger.getEntries();
    logger.debug('test', 'snapshot-stability');
    const after = logger.getEntries();
    expect(before).not.toBe(after); // 变更后重建
    const again = logger.getEntries();
    expect(after).toBe(again); // 未变更时引用不变
  });
});

describe('describeError', () => {
  it('拼接 Error cause 链', () => {
    const root = new TypeError('Network request failed');
    const wrapped = new Error('HTTP 413', { cause: root });
    expect(describeError(wrapped)).toBe('Error: HTTP 413 <- TypeError: Network request failed');
  });

  it('非 Error 值与裸字符串', () => {
    expect(describeError('boom')).toBe('boom');
    expect(describeError(42)).toBe('42');
  });

  it('无 cause 的普通 Error', () => {
    expect(describeError(new Error('plain'))).toBe('Error: plain');
  });
});
