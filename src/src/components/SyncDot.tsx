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

export function SyncDot({ status }: { status: SyncStatus }) {
  const p = useShellPalette();
  const color = colorFor(status, p);
  if (status === 'syncing') {
    return <ActivityIndicator size={14} color={color} />;
  }
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
