// 设置页：外观与显示（主题/字号带预览卡片）、网络同步入口、诊断日志、关于应用
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';

import { FONT_SIZES, FONT_SIZE_LABELS, AUTO_LOCK_OPTIONS, settingsStore, type FontSize, type ThemeMode } from '../../stores/settingsStore';
import { NOTE_COLOR_THEMES } from '../../data/theme';
import type { ShellPalette } from '../../constants/theme';
import { useShellPalette } from '../../hooks/use-shell';
import { getDeviceId } from '../../services/deviceId';
import { logger } from '../../services/logger';
import { getLastCrash, clearLastCrash } from '../../services/crash';
import { exportNotesAsync, importNotesAsync } from '../../services/backup';
import { getLastBackupDate } from '../../services/dbBackup';
import { verifyPinAsync } from '../../services/pin';
import { lockStore } from '../../stores/lockStore';
import { PinSetupModal, type PinModalMode } from '../../components/PinSetupModal';

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: '跟随系统' },
  { key: 'light', label: '浅色模式' },
  { key: 'dark', label: '深色模式' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const p = useShellPalette();
  const styles = makeStyles(p);

  const themeMode = settingsStore((s) => s.themeMode);
  const fontSize = settingsStore((s) => s.fontSize);
  const [lastCrash, setLastCrash] = useState<string | null>(() => getLastCrash());
  const [logCopied, setLogCopied] = useState(false);
  // 仅用于在清空/复制日志后触发本组件重渲染以刷新条数显示
  const [, setLogTick] = useState(0);
  const [dataBusy, setDataBusy] = useState(false);
  const [lastBackupDate] = useState(() => getLastBackupDate());

  const pinEnabled = lockStore((s) => s.pinEnabled);
  const biometricEnabled = lockStore((s) => s.biometricEnabled);
  const biometricAvailable = lockStore((s) => s.biometricAvailable);
  const autoLockMinutes = settingsStore((s) => s.autoLockMinutes);
  const [pinModal, setPinModal] = useState<PinModalMode | null>(null);

  const onPinModalSubmit = async (values: Record<string, string>): Promise<string | null> => {
    const mode = pinModal;
    if (mode === 'enable') {
      await lockStore.getState().enablePinAsync(values.pin);
      return null;
    }
    if (mode === 'change') {
      const ok = await verifyPinAsync(values.current);
      if (!ok) return '当前 PIN 不正确';
      await lockStore.getState().enablePinAsync(values.pin);
      return null;
    }
    // disable
    const ok = await verifyPinAsync(values.current);
    if (!ok) return '当前 PIN 不正确';
    await lockStore.getState().clearPinAsync();
    return null;
  };

  const onExport = async () => {
    setDataBusy(true);
    try {
      const count = await exportNotesAsync();
      logger.info('settings', `export finished: ${count} notes`);
    } catch (ex) {
      Alert.alert('导出失败', ex instanceof Error ? ex.message : String(ex));
    } finally {
      setDataBusy(false);
    }
  };

  const onImport = async () => {
    setDataBusy(true);
    try {
      const summary = await importNotesAsync();
      if (!summary) return;
      const lines = [`共 ${summary.total} 条，导入 ${summary.imported} 条`];
      if (summary.skipped > 0) lines.push(`跳过重复 ${summary.skipped} 条`);
      if (summary.invalid > 0) lines.push(`无效 ${summary.invalid} 条`);
      Alert.alert('导入完成', lines.join('，'));
    } catch (ex) {
      Alert.alert('导入失败', ex instanceof Error ? ex.message : String(ex));
    } finally {
      setDataBusy(false);
    }
  };

  const copyText = async (text: string) => {
    await Clipboard.setStringAsync(text);
    logger.info('settings', 'diagnostic text copied to clipboard');
  };

  const copyLogs = async () => {
    await Clipboard.setStringAsync(logger.getLines().join('\n') || '（暂无日志）');
    setLogCopied(true);
    setTimeout(() => setLogCopied(false), 2000);
    logger.info('settings', 'log buffer copied to clipboard');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 外观与显示 */}
        <Text style={styles.sectionTitle}>外观与显示</Text>
        <View style={styles.card}>
          <Text style={styles.rowLabel}>主题</Text>
          <View style={styles.optionRow}>
            {THEME_OPTIONS.map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => settingsStore.getState().setThemeMode(opt.key)}
                style={[styles.option, themeMode === opt.key && styles.optionActive]}
              >
                <Text style={[styles.optionText, themeMode === opt.key && styles.optionTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.rowLabel}>正文字号</Text>
          <View style={styles.optionRow}>
            {FONT_SIZES.map((size) => (
              <Pressable
                key={size}
                onPress={() => settingsStore.getState().setFontSize(size as FontSize)}
                style={[styles.option, fontSize === size && styles.optionActive]}
              >
                <Text style={[styles.optionText, fontSize === size && styles.optionTextActive]}>
                  {FONT_SIZE_LABELS[size]} ({size})
                </Text>
              </Pressable>
            ))}
          </View>

          {/* 实时预览卡片 */}
          <View
            style={[
              styles.previewCard,
              { backgroundColor: NOTE_COLOR_THEMES.yellow.background, borderColor: NOTE_COLOR_THEMES.yellow.border },
            ]}
          >
            <Text style={{ color: NOTE_COLOR_THEMES.yellow.text, fontSize, fontWeight: '700' }}>字号预览</Text>
            <Text style={{ color: NOTE_COLOR_THEMES.yellow.secondary, fontSize: fontSize - 2, marginTop: 4 }}>
              这是便签正文在当前字号下的显示效果。
            </Text>
          </View>
        </View>

        {/* 网络同步入口 */}
        <Text style={styles.sectionTitle}>网络同步</Text>
        <Pressable style={[styles.card, styles.entryRow]} onPress={() => router.push('/settings/sync')}>
          <Text style={styles.entryText} numberOfLines={1}>
            同步设置
          </Text>
          <Text style={styles.entryArrow}>›</Text>
        </Pressable>

        {/* 数据管理 */}
        <Text style={styles.sectionTitle}>数据管理</Text>
        <View style={styles.card}>
          <Text style={styles.aboutNote}>
            导出全部便签（含归档）为 JSON 文件备份或迁移到其他设备；导入按便签 ID 去重，不会覆盖已有数据。
          </Text>
          <Text style={styles.aboutNote}>
            本地每日自动备份保留最近 7 份{lastBackupDate ? `，最近一次：${lastBackupDate}` : '，尚未备份'}。
          </Text>
          <View style={styles.logButtonRow}>
            <Pressable style={styles.logButton} disabled={dataBusy} onPress={() => void onExport()}>
              <Text style={styles.logButtonText}>导出数据</Text>
            </Pressable>
            <Pressable
              style={[styles.logButton, styles.logButtonSecondary]}
              disabled={dataBusy}
              onPress={() => void onImport()}
            >
              <Text style={styles.logButtonTextMuted}>导入数据</Text>
            </Pressable>
          </View>
        </View>

        {/* 隐私保护 */}
        <Text style={styles.sectionTitle}>隐私保护</Text>
        <View style={styles.card}>
          {pinEnabled ? (
            <>
              <View style={styles.aboutRow}>
                <Text style={styles.aboutLabel}>PIN 锁</Text>
                <Text style={[styles.aboutValue, { color: '#209E35' }]}>已启用</Text>
              </View>
              <View style={styles.aboutRow}>
                <Text style={styles.aboutLabel}>生物识别解锁</Text>
                {biometricAvailable ? (
                  <Switch
                    value={biometricEnabled}
                    onValueChange={(v) => void lockStore.getState().setBiometricAsync(v)}
                  />
                ) : (
                  <Text style={styles.aboutLabel}>设备不支持或未录入</Text>
                )}
              </View>
              <Text style={styles.rowLabel}>切后台后要求解锁</Text>
              <View style={styles.optionRow}>
                {AUTO_LOCK_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => settingsStore.getState().setAutoLockMinutes(opt.value)}
                    style={[styles.option, autoLockMinutes === opt.value && styles.optionActive]}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        autoLockMinutes === opt.value && styles.optionTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.aboutNote}>启用后每次打开应用都需解锁；清除 PIN 需验证当前 PIN。</Text>
              <View style={styles.logButtonRow}>
                <Pressable style={styles.logButton} onPress={() => setPinModal('change')}>
                  <Text style={styles.logButtonText}>修改 PIN</Text>
                </Pressable>
                <Pressable
                  style={[styles.logButton, styles.logButtonDanger]}
                  onPress={() => setPinModal('disable')}
                >
                  <Text style={styles.logButtonTextMuted}>清除 PIN</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.aboutNote}>
                启用 PIN 锁后，每次打开应用都需要输入 PIN 或通过生物识别解锁，保护你的便签隐私。
              </Text>
              <View style={styles.logButtonRow}>
                <Pressable style={styles.logButton} onPress={() => setPinModal('enable')}>
                  <Text style={styles.logButtonText}>启用 PIN 锁</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        {/* 诊断日志 */}
        <Text style={styles.sectionTitle}>诊断日志</Text>
        <View style={styles.card}>
          <Text style={styles.aboutNote}>
            记录同步统计、保存失败与未捕获异常（不含便签正文）。应用崩溃后可在此查看并复制崩溃报告。
          </Text>
          {lastCrash ? (
            <View style={styles.crashBox}>
              <Text style={styles.crashTitle}>上次崩溃 / 异常</Text>
              <Text style={styles.crashText} numberOfLines={4}>
                {lastCrash}
              </Text>
              <View style={styles.logButtonRow}>
                <Pressable style={styles.logButton} onPress={() => void copyText(lastCrash)}>
                  <Text style={styles.logButtonText}>复制崩溃信息</Text>
                </Pressable>
                <Pressable
                  style={[styles.logButton, styles.logButtonDanger]}
                  onPress={() => {
                    clearLastCrash();
                    setLastCrash(null);
                  }}
                >
                  <Text style={styles.logButtonTextMuted}>清除</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <View style={styles.logButtonRow}>
            <Pressable
              style={[styles.logButton, logCopied && styles.logButtonCopied]}
              onPress={() => void copyLogs()}
            >
              <Text style={[styles.logButtonText, logCopied && styles.logButtonTextSuccess]}>
                {logCopied ? '已复制' : `复制日志（${logger.count()} 条）`}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.logButton, styles.logButtonDanger]}
              onPress={() => {
                logger.clear();
                setLogTick((t) => t + 1);
              }}
            >
              <Text style={styles.logButtonTextMuted}>清空日志</Text>
            </Pressable>
          </View>
        </View>

        {/* 关于应用 */}
        <Text style={styles.sectionTitle}>关于应用</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>应用版本</Text>
            <Text style={styles.aboutValue}>v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>设备标识</Text>
            <Text style={styles.aboutValue}>{getDeviceId()}</Text>
          </View>
        </View>
        <PinSetupModal
          key={pinModal ?? 'pin-modal'}
          visible={pinModal !== null}
          mode={pinModal ?? 'enable'}
          onClose={() => setPinModal(null)}
          onSubmit={onPinModalSubmit}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (p: ShellPalette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: p.background,
    },
    content: {
      padding: 16,
      paddingBottom: 40,
    },
    sectionTitle: {
      color: p.secondaryText,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
      marginTop: 16,
      textTransform: 'uppercase',
    },
    card: {
      backgroundColor: p.surface,
      borderRadius: 12,
      padding: 14,
    },
    rowLabel: {
      color: p.text,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 8,
    },
    optionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    option: {
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    optionActive: {
      backgroundColor: p.accent,
      borderColor: p.accent,
    },
    optionText: {
      color: p.text,
      fontSize: 13,
    },
    optionTextActive: {
      color: p.onAccent,
      fontWeight: '600',
    },
    previewCard: {
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12,
      marginTop: 4,
    },
    entryRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    entryText: {
      color: p.text,
      fontSize: 15,
      flex: 1,
    },
    entryArrow: {
      color: p.secondaryText,
      fontSize: 20,
    },
    aboutRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    aboutLabel: {
      color: p.secondaryText,
      fontSize: 14,
    },
    aboutValue: {
      color: p.text,
      fontSize: 14,
      fontWeight: '500',
    },
    aboutNote: {
      color: p.secondaryText,
      fontSize: 12,
      marginTop: 8,
      lineHeight: 18,
    },
    crashBox: {
      marginTop: 10,
      backgroundColor: p.background,
      borderRadius: 8,
      padding: 10,
    },
    crashTitle: {
      color: p.danger,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 4,
    },
    crashText: {
      color: p.secondaryText,
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 15,
    },
    logButtonRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 10,
    },
    logButton: {
      flex: 1,
      backgroundColor: p.accent,
      borderRadius: 8,
      alignItems: 'center',
      paddingVertical: 9,
    },
    logButtonDanger: {
      backgroundColor: p.border,
    },
    logButtonCopied: {
      backgroundColor: '#209E35',
    },
    logButtonSecondary: {
      backgroundColor: p.border,
    },
    // 琥珀色底：深字保证对比度
    logButtonText: {
      color: p.onAccent,
      fontSize: 13,
      fontWeight: '600',
    },
    // 绿色底（复制成功态）：白字
    logButtonTextSuccess: {
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: '600',
    },
    // 灰色底（次级动作）：跟随主题文字色
    logButtonTextMuted: {
      color: p.text,
      fontSize: 13,
      fontWeight: '600',
    },
  });
