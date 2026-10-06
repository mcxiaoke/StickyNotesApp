// 自动保存协调器（方案 §4.2 编辑页保存策略）：输入停止 500ms 后静默持久化；
// 页面返回、进入后台时调用 flush() 无延迟刷盘。
import { logger } from './logger';

type Saver = (id: string, content: string) => Promise<void>;

export class AutoSaveCoordinator {
  /** 失败后自动重试的上限，避免持久性失败（如数据库不可写）演变成无限重试 */
  private static readonly MAX_RETRIES = 3;
  /** 重试间隔：比输入防抖长，给外部故障留恢复时间，也避免高频重试打日志 */
  private static readonly RETRY_DELAY_MS = 2_000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { id: string; content: string } | null = null;
  private flushing: Promise<void> | null = null;
  private retries = 0;

  constructor(
    private readonly save: Saver,
    private readonly debounceMs = 500,
  ) {}

  schedule(id: string, content: string): void {
    // 新的输入视为新一轮：重置重试预算
    this.retries = 0;
    this.pending = { id, content };
    this.arm(this.debounceMs);
  }

  /** 立即落盘挂起的编辑（返回已完成的 Promise；无挂起时立即 resolve） */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing) return this.flushing;

    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.flushing = this.save(pending.id, pending.content)
      .then(() => {
        this.retries = 0;
      })
      .catch((ex) => {
        // 保存失败：内容留在 pending 里不丢，并自行重排一次重试。
        // 若不重排，只有「下一次输入」或「返回/进后台」才会再触发 flush——
        // 用户输完一句停在页面上时，那次保存会一直不落盘。
        logger.error('autosave', `save failed for note ${pending.id}: ${ex instanceof Error ? ex.message : String(ex)}`);
        this.pending = pending;
        if (this.retries < AutoSaveCoordinator.MAX_RETRIES) {
          this.retries++;
          this.arm(AutoSaveCoordinator.RETRY_DELAY_MS);
        } else {
          logger.error(
            'autosave',
            `giving up auto retry for note ${pending.id} after ${AutoSaveCoordinator.MAX_RETRIES} attempts; will retry on next edit or flush`,
          );
        }
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  private arm(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
  }
}
