// 崩溃状态 store：全局未捕获异常在 release 下通过本 store 触发内置崩溃屏
import { create } from 'zustand';

interface CrashState {
  /** release 模式下全局异常时置为崩溃报告文本；null 表示正常运行 */
  fatalError: string | null;
  showFatal: (report: string) => void;
  /** 从崩溃屏恢复（用户点击重置应用） */
  dismissFatal: () => void;
}

export const crashStore = create<CrashState>((set) => ({
  fatalError: null,
  showFatal: (report) => set({ fatalError: report }),
  dismissFatal: () => set({ fatalError: null }),
}));
