// 自动保存协调器（方案 §4.2 编辑页保存策略）：输入停止 500ms 后静默持久化；
// 页面返回、进入后台时调用 flush() 无延迟刷盘。
import { logger } from './logger';

type Saver = (id: string, content: string) => Promise<void>;

export class AutoSaveCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { id: string; content: string } | null = null;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly save: Saver,
    private readonly debounceMs = 500,
  ) {}

  schedule(id: string, content: string): void {
    this.pending = { id, content };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
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
      .catch((ex) => {
        // 保存失败：记录并重新排队，等待下次防抖重试
        logger.error('autosave', `save failed for note ${pending.id}: ${ex instanceof Error ? ex.message : String(ex)}`);
        this.pending = pending;
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }
}
