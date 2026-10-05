// 内置错误屏：渲染错误（ErrorBoundary）与 release 全局异常共用。
// 展示完整错误报告，支持复制，不静默退出。
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Updates from 'expo-updates';
import { Ionicons } from '@expo/vector-icons';
import { logger } from '../services/logger';

export function CrashScreen({
  report,
  onReset,
}: {
  report: string;
  onReset?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(report);
    setCopied(true);
    logger.info('crash', 'crash report copied to clipboard');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="bug" size={28} color="#E5635F" />
        <Text style={styles.title}>应用遇到错误</Text>
      </View>
      <Text style={styles.hint}>
        {expanded ? '完整错误信息如下：' : '错误摘要（点击文字展开完整信息）：'}
      </Text>
      <ScrollView style={styles.reportBox}>
        <Pressable onPress={() => setExpanded((v) => !v)}>
          <Text style={styles.reportText} numberOfLines={expanded ? undefined : 12}>
            {report}
          </Text>
        </Pressable>
      </ScrollView>
      <View style={styles.buttonRow}>
        <Pressable style={styles.button} onPress={() => void copy()}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#FFFFFF" />
          <Text style={styles.buttonText}>{copied ? '已复制' : '复制错误信息'}</Text>
        </Pressable>
        {onReset ? (
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={onReset}>
            <Ionicons name="refresh-outline" size={16} color="#1C1C1E" />
            <Text style={styles.secondaryButtonText}>重置应用</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void Updates.reloadAsync()}>
            <Ionicons name="refresh-outline" size={16} color="#1C1C1E" />
            <Text style={styles.secondaryButtonText}>重启应用</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111114',
    padding: 20,
    justifyContent: 'center',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: '#F2F2F4',
    fontSize: 22,
    fontWeight: '700',
  },
  hint: {
    color: '#A0A0A6',
    fontSize: 13,
  },
  reportBox: {
    backgroundColor: '#1E1E22',
    borderRadius: 10,
    padding: 12,
    maxHeight: 420,
    flexGrow: 0,
  },
  reportText: {
    color: '#D8D8DC',
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    backgroundColor: '#E5635F',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  secondaryButton: {
    backgroundColor: '#E0A800',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: '#1C1C1E',
    fontSize: 15,
    fontWeight: '600',
  },
});
