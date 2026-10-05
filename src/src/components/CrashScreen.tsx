// 内置错误屏：渲染错误（ErrorBoundary）与 release 全局异常共用。
// 展示完整错误报告，支持复制，不静默退出。
// 使用深色语义色固定渲染（崩溃场景下不依赖运行时主题状态的正确性）
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Updates from 'expo-updates';
import { Ionicons } from '@expo/vector-icons';
import { logger } from '../services/logger';
import { DARK_SHELL } from '../constants/theme';
import { SPACING, RADII, FONT, LINE_HEIGHT } from '../constants/metrics';

export function CrashScreen({
  report,
  onReset,
}: {
  report: string;
  onReset?: () => void;
}) {
  const p = DARK_SHELL;
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
        <Ionicons name="bug" size={28} color={p.danger} />
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
        <Pressable style={[styles.button, { backgroundColor: p.danger }]} onPress={() => void copy()}>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={p.onError} />
          <Text style={[styles.buttonText, { color: p.onError }]}>{copied ? '已复制' : '复制错误信息'}</Text>
        </Pressable>
        {onReset ? (
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={onReset}>
            <Ionicons name="refresh-outline" size={16} color={p.onAccent} />
            <Text style={styles.secondaryButtonText}>重置应用</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => void Updates.reloadAsync()}>
            <Ionicons name="refresh-outline" size={16} color={p.onAccent} />
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
    backgroundColor: DARK_SHELL.background,
    padding: SPACING.xl - 4,
    justifyContent: 'center',
    gap: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md - 2,
  },
  title: {
    color: DARK_SHELL.text,
    fontSize: FONT.display,
    lineHeight: LINE_HEIGHT.display,
    fontWeight: '700',
  },
  hint: {
    color: DARK_SHELL.secondaryText,
    fontSize: FONT.label,
    lineHeight: LINE_HEIGHT.label,
  },
  reportBox: {
    backgroundColor: DARK_SHELL.surface,
    borderRadius: RADII.md,
    padding: SPACING.md,
    maxHeight: 420,
    flexGrow: 0,
  },
  reportText: {
    color: DARK_SHELL.secondaryText,
    fontFamily: 'monospace',
    fontSize: FONT.caption,
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: SPACING.md - 2,
  },
  button: {
    flex: 1,
    borderRadius: RADII.md,
    paddingVertical: SPACING.md + 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: SPACING.xs + 2,
  },
  secondaryButton: {
    backgroundColor: DARK_SHELL.accent,
  },
  buttonText: {
    fontSize: FONT.bodyLg,
    lineHeight: LINE_HEIGHT.bodyLg,
    fontWeight: '600',
  },
  secondaryButtonText: {
    color: DARK_SHELL.onAccent,
    fontSize: FONT.bodyLg,
    lineHeight: LINE_HEIGHT.bodyLg,
    fontWeight: '600',
  },
});
