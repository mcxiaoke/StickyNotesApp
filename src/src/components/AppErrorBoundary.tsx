// 根级渲染错误兜底：捕获子树渲染期异常，展示可复制的错误屏
import { Component, type ReactNode } from 'react';
import { CrashScreen } from './CrashScreen';
import { formatError } from '../services/crash';
import { logger } from '../services/logger';

interface Props {
  children: ReactNode;
}

interface State {
  report: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { report: null };

  static getDerivedStateFromError(error: unknown): State {
    return { report: formatError(error, 'render') };
  }

  componentDidCatch(error: unknown): void {
    logger.error('boundary', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }

  render(): ReactNode {
    if (this.state.report) {
      return <CrashScreen report={this.state.report} onReset={() => this.setState({ report: null })} />;
    }
    return this.props.children;
  }
}
