// 设置页：外观与显示（主题/字号带预览卡片）、网络同步入口、关于应用
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';

import { FONT_SIZES, FONT_SIZE_LABELS, settingsStore, type FontSize, type ThemeMode } from '../../stores/settingsStore';
import { NOTE_COLOR_THEMES } from '../../data/theme';
import { DARK_SHELL, LIGHT_SHELL, type ShellPalette } from '../../constants/theme';
import { getDeviceId } from '../../services/deviceId';

const THEME_OPTIONS: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: '跟随系统' },
  { key: 'light', label: '浅色模式' },
  { key: 'dark', label: '深色模式' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const p = systemScheme === 'dark' ? DARK_SHELL : LIGHT_SHELL;
  const styles = makeStyles(p);

  const themeMode = settingsStore((s) => s.themeMode);
  const fontSize = settingsStore((s) => s.fontSize);

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
        <Pressable style={styles.card} onPress={() => router.push('/settings/sync')}>
          <Text style={styles.entryText}>同步设置（WebDAV / Cloudflare R2）</Text>
          <Text style={styles.entryArrow}>›</Text>
        </Pressable>

        {/* 关于应用 */}
        <Text style={styles.sectionTitle}>关于应用</Text>
        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>应用版本</Text>
            <Text style={styles.aboutValue}>v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>同步协议</Text>
            <Text style={styles.aboutValue}>便签网络同步协议 v1</Text>
          </View>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>设备标识</Text>
            <Text style={styles.aboutValue}>{getDeviceId()}</Text>
          </View>
          <Text style={styles.aboutNote}>
            便签数据仅存储在本机与你的自有网盘/S3 存储桶，不经任何第三方服务器中转。
          </Text>
        </View>
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
      color: '#FFFFFF',
      fontWeight: '600',
    },
    previewCard: {
      borderRadius: 10,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 12,
      marginTop: 4,
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
  });
