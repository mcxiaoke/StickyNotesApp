// 同步状态指示点：绿=已同步，转圈=同步中，红=异常，灰=未启用
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { SyncStatus } from '../stores/syncStore';

const COLOR_BY_STATUS: Record<SyncStatus, string> = {
  disabled: '#A0A0A6',
  idle: '#A0A0A6',
  success: '#34A853',
  error: '#E0443E',
  syncing: '#1079D1',
};

export function SyncDot({ status }: { status: SyncStatus }) {
  if (status === 'syncing') {
    return <ActivityIndicator size={14} color={COLOR_BY_STATUS.syncing} />;
  }
  return <View style={[styles.dot, { backgroundColor: COLOR_BY_STATUS[status] }]} />;
}

const styles = StyleSheet.create({
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
