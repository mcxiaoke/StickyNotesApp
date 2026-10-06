// 日志查看页：实时滚动（inverted 列表新日志置底）、级别过滤、复制全部、导出（系统分享 txt）、清空。
// 数据源为 logger 内存环形缓冲；落盘的 warn/error 历史仅在「导出」时合并（设计稿已定，页内不单独展示）。
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import type { ShellPalette } from '../../constants/theme';
import { useShellPalette } from '../../hooks/use-shell';
import { SPACING, RADII, FONT, LINE_HEIGHT } from '../../constants/metrics';
import { formatDateTime } from '../../services/time';
import { exportLogsAsync } from '../../services/logExport';
import { clearPersistedAsync } from '../../services/logPersist';
import { logger, type LogEntry, type LogLevel } from '../../services/logger';

type Filter = 'all' | 'info' | 'warn' | 'error';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'info', label: '信息' },
  { key: 'warn', label: '警告' },
  { key: 'error', label: '错误' },
];

/** 稳定引用的快照与订阅函数，供 useSyncExternalStore 使用 */
const getSnapshot = () => logger.getEntries();
const subscribe = (cb: () => void) => logger.subscribe(cb);

export default function LogsScreen() {
  const p = useShellPalette();
  const styles = useMemo(() => makeStyles(p), [p]);
  const entries = useSyncExternalStore(subscribe, getSnapshot);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<'copy' | 'export' | null>(null);

  const visible = useMemo(() => {
    if (filter === 'all') return entries;
    if (filter === 'info') return entries.filter((e) => e.level === 'info' || e.level === 'debug');
    return entries.filter((e) => e.level === (filter as LogLevel));
  }, [entries, filter]);

  const copyAll = useCallback(async () => {
    setBusy('copy');
    try {
      const text = visible
        .map((e) => `${e.time} [${e.level.toUpperCase()}] [${e.tag}] ${e.message}`)
        .join('\n');
      await Clipboard.setStringAsync(text || '（暂无日志）');
      logger.info('logs', `log buffer copied to clipboard (${visible.length} entries)`);
    } catch (ex) {
      logger.error('logs', `copy logs failed: ${ex instanceof Error ? ex.message : String(ex)}`);
    } finally {
      setBusy(null);
    }
  }, [visible]);

  const exportLogs = useCallback(async () => {
    setBusy('export');
    try {
      await exportLogsAsync();
    } catch (ex) {
      logger.error('logs', `export logs failed: ${ex instanceof Error ? ex.message : String(ex)}`);
      Alert.alert('导出失败', ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(null);
    }
  }, []);

  const confirmClear = useCallback(() => {
    Alert.alert('清空日志', '将同时清除内存缓冲与落盘的历史警告/错误日志。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清空',
        style: 'destructive',
        onPress: () => {
          logger.clear();
          void clearPersistedAsync();
        },
      },
    ]);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: LogEntry }) => {
      const color =
        item.level === 'error' ? p.danger : item.level === 'warn' ? p.warning : item.level === 'debug' ? p.secondaryText : p.text;
      return (
        <View style={styles.entry}>
          <Text style={styles.entryMeta}>
            {formatDateTime(item.time)} [{item.level.toUpperCase()}] [{item.tag}]
          </Text>
          <Text style={[styles.entryMessage, { color }]}>{item.message}</Text>
        </View>
      );
    },
    [p, styles],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.toolbar}>
        <View style={styles.chipRow}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              style={[styles.chip, filter === f.key && styles.chipActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.buttonRow}>
          <Pressable style={styles.button} onPress={() => void copyAll()} disabled={busy !== null}>
            {busy === 'copy' ? <ActivityIndicator size="small" color={p.onAccent} /> : <Text style={styles.buttonText}>复制全部</Text>}
          </Pressable>
          <Pressable style={styles.button} onPress={() => void exportLogs()} disabled={busy !== null}>
            {busy === 'export' ? (
              <ActivityIndicator size="small" color={p.onAccent} />
            ) : (
              <Text style={styles.buttonText}>导出 / 分享</Text>
            )}
          </Pressable>
          <Pressable style={[styles.button, styles.buttonDanger]} onPress={confirmClear} disabled={busy !== null}>
            <Text style={styles.buttonText}>清空</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          共 {visible.length} 条（内存缓冲 {logger.count()} 条）。导出会合并历史警告/错误日志；不含便签正文与凭据。
        </Text>
      </View>
      {visible.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>暂无{filter === 'all' ? '' : FILTERS.find((f) => f.key === filter)?.label}日志</Text>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={visible}
          keyExtractor={(e) => String(e.seq)}
          renderItem={renderItem}
          inverted
          initialNumToRender={30}
          maxToRenderPerBatch={50}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (p: ShellPalette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: p.background,
    },
    toolbar: {
      paddingHorizontal: SPACING.lg,
      paddingTop: SPACING.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
      backgroundColor: p.surface,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: SPACING.sm,
      marginBottom: SPACING.md,
    },
    chip: {
      borderRadius: RADII.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.xs + 2,
    },
    chipActive: {
      backgroundColor: p.accentContainer,
      borderColor: p.accentContainer,
    },
    chipText: {
      color: p.text,
      fontSize: FONT.label,
      lineHeight: LINE_HEIGHT.label,
    },
    chipTextActive: {
      color: p.onAccentContainer,
      fontWeight: '600',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: SPACING.sm,
      marginBottom: SPACING.sm,
    },
    button: {
      flex: 1,
      backgroundColor: p.accent,
      borderRadius: RADII.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: SPACING.sm + 2,
      flexDirection: 'row',
      gap: SPACING.xs,
    },
    buttonDanger: {
      backgroundColor: p.danger,
    },
    buttonText: {
      color: p.onAccent,
      fontSize: FONT.label,
      lineHeight: LINE_HEIGHT.label,
      fontWeight: '600',
    },
    hint: {
      color: p.secondaryText,
      fontSize: FONT.small,
      lineHeight: LINE_HEIGHT.small,
      marginBottom: SPACING.sm,
    },
    list: {
      flex: 1,
      paddingHorizontal: SPACING.lg,
    },
    entry: {
      paddingVertical: SPACING.xs + 2,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
    },
    entryMeta: {
      color: p.secondaryText,
      fontSize: FONT.small,
      lineHeight: LINE_HEIGHT.small,
    },
    entryMessage: {
      fontSize: FONT.small,
      lineHeight: LINE_HEIGHT.small + 2,
      marginTop: 2,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      color: p.secondaryText,
      fontSize: FONT.body,
      lineHeight: LINE_HEIGHT.body,
    },
  });
