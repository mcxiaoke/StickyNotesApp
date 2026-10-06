// 同步状态指示点：主色=已同步，转圈=同步中，红=异常，灰=未启用
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { SyncStatus } from '../stores/syncStore';
import { useShellPalette } from '../hooks/use-shell';
import type { ShellPalette } from '../constants/theme';

function colorFor(status: SyncStatus, p: ShellPalette): string {
  switch (status) {
    case 'success':
    case 'syncing':
      return p.accent;
    case 'error':
      return p.danger;
    default:
      return p.secondaryText;
  }
}

export function SyncDot({ status, inFlight }: { status: SyncStatus; inFlight: boolean }) {
  const p = useShellPalette();
  // 转圈只看 inFlight：它由同步轮次的事件驱动，与触发入口无关（防抖/前台/后台/手动都会亮）
  if (inFlight) {
    return <ActivityIndicator size={14} color={p.accent} />;
  }
  return <View style={[styles.dot, { backgroundColor: colorFor(status, p) }]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
