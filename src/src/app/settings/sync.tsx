// 同步设置页：后端选型、WebDAV/R2 参数、凭据安全存储、测试连接、立即同步、状态诊断
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DARK_SHELL, LIGHT_SHELL, type ShellPalette } from '../../constants/theme';
import { getDeviceId } from '../../services/deviceId';
import { getS3SecretAsync, getWebDavPasswordAsync, setS3SecretAsync, setWebDavPasswordAsync } from '../../services/credential';
import { S3Backend } from '../../sync/backends/s3';
import { WebDavBackend } from '../../sync/backends/webdav';
import { applyBackgroundSyncSchedule } from '../../sync/scheduler';
import {
  DEFAULT_SYNC_SETTINGS,
  loadSyncSettings,
  saveSyncSettings,
  type SyncBackendType,
  type SyncSettings,
} from '../../sync/settings';
import { syncStore } from '../../stores/syncStore';
import { notesStore } from '../../stores/notesStore';
import { relativeTime } from '../../services/time';

const INTERVAL_OPTIONS = [5, 10, 15, 30, 60];

export default function SyncSettingsScreen() {
  const p = useColorScheme() === 'dark' ? DARK_SHELL : LIGHT_SHELL;
  const styles = makeStyles(p);

  const [form, setForm] = useState<SyncSettings>(DEFAULT_SYNC_SETTINGS);
  const [webdavPassword, setWebdavPassword] = useState('');
  const [s3Secret, setS3Secret] = useState('');
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const status = syncStore((s) => s.status);
  const lastSuccessAt = syncStore((s) => s.lastSuccessAt);
  const lastError = syncStore((s) => s.lastError);

  useEffect(() => {
    void (async () => {
      const settings = loadSyncSettings();
      setForm(settings);
      setWebdavPassword((await getWebDavPasswordAsync()) ?? '');
      setS3Secret((await getS3SecretAsync()) ?? '');
    })();
  }, []);

  const patch = (updater: (draft: SyncSettings) => SyncSettings) => {
    setForm((prev) => updater(prev));
    setDirty(true);
    setTestResult(null);
  };

  const statusLine = useMemo(() => {
    switch (status) {
      case 'syncing':
        return '同步中...';
      case 'success':
        return '已启用 · 最近同步成功';
      case 'error':
        return '已启用 · 最近同步失败';
      default:
        return form.enabled ? '已启用' : '未启用';
    }
  }, [status, form.enabled]);

  const persist = async (): Promise<void> => {
    saveSyncSettings(form);
    await setWebDavPasswordAsync(webdavPassword);
    await setS3SecretAsync(s3Secret);
    await applyBackgroundSyncSchedule();
    syncStore.getState().hydrate();
    setDirty(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const startedAt = Date.now();
    try {
      const backend = buildBackendFromForm(form, webdavPassword, s3Secret);
      await backend.testAsync();
      backend.dispose();
      setTestResult(`连接成功（${Date.now() - startedAt} ms）`);
    } catch (ex) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setTestResult(`连接失败：${message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSyncNow = async () => {
    await persist();
    setSyncing(true);
    try {
      await syncStore.getState().runNow();
      await notesStore.getState().refreshAsync();
      Alert.alert('同步完成', '本轮同步已结束，详情见下方状态诊断。');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <Text style={styles.rowLabel}>启用网络同步</Text>
            <Switch
              value={form.enabled}
              onValueChange={(v) => patch((d) => ({ ...d, enabled: v }))}
              trackColor={{ true: p.accent }}
            />
          </View>
          <Text style={styles.statusText}>状态：{statusLine}</Text>
          {lastSuccessAt ? (
            <Text style={styles.statusText}>最近成功同步：{relativeTime(lastSuccessAt)}</Text>
          ) : null}
          {lastError ? <Text style={styles.errorText}>上次错误：{lastError}</Text> : null}
        </View>

        <Text style={styles.sectionTitle}>存储后端</Text>
        <View style={styles.card}>
          <View style={styles.optionRow}>
            {(
              [
                { key: 'webdav', label: 'WebDAV' },
                { key: 's3', label: 'Cloudflare R2 / S3' },
              ] as { key: SyncBackendType; label: string }[]
            ).map((opt) => (
              <Pressable
                key={opt.key}
                onPress={() => patch((d) => ({ ...d, backendType: opt.key }))}
                style={[styles.option, form.backendType === opt.key && styles.optionActive]}
              >
                <Text style={[styles.optionText, form.backendType === opt.key && styles.optionTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {form.backendType === 'webdav' ? (
            <>
              <Field
                label="服务器地址"
                placeholder="https://dav.jianguoyun.com/dav/"
                value={form.webdav.serverUrl}
                onChangeText={(v) => patch((d) => ({ ...d, webdav: { ...d.webdav, serverUrl: v } }))}
                autoCapitalize="none"
                keyboardType="url"
                p={p}
              />
              <Field
                label="用户名"
                placeholder="账号 / 邮箱"
                value={form.webdav.username}
                onChangeText={(v) => patch((d) => ({ ...d, webdav: { ...d.webdav, username: v } }))}
                autoCapitalize="none"
                p={p}
              />
              <Field
                label="密码 / 应用专用密码"
                placeholder="应用专用密码（不落明文）"
                value={webdavPassword}
                onChangeText={(v) => {
                  setWebdavPassword(v);
                  setDirty(true);
                }}
                secureTextEntry
                p={p}
              />
              <View style={styles.switchRow}>
                <View style={styles.flex1}>
                  <Text style={styles.rowLabel}>允许明文 HTTP</Text>
                  <Text style={styles.warningText}>仅限内网 NAS 等可信环境，公网使用有泄露风险。</Text>
                </View>
                <Switch
                  value={form.webdav.allowHttp}
                  onValueChange={(v) => patch((d) => ({ ...d, webdav: { ...d.webdav, allowHttp: v } }))}
                  trackColor={{ true: p.accent }}
                />
              </View>
            </>
          ) : (
            <>
              <Field
                label="Endpoint"
                placeholder="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
                value={form.s3.endpoint}
                onChangeText={(v) => patch((d) => ({ ...d, s3: { ...d.s3, endpoint: v } }))}
                autoCapitalize="none"
                keyboardType="url"
                p={p}
              />
              <Field
                label="Bucket 桶名"
                placeholder="stickynotes"
                value={form.s3.bucket}
                onChangeText={(v) => patch((d) => ({ ...d, s3: { ...d.s3, bucket: v } }))}
                autoCapitalize="none"
                p={p}
              />
              <Field
                label="BasePrefix（可选）"
                placeholder="stickynotes/"
                value={form.s3.basePrefix}
                onChangeText={(v) => patch((d) => ({ ...d, s3: { ...d.s3, basePrefix: v } }))}
                autoCapitalize="none"
                p={p}
              />
              <Field
                label="AccessKey ID"
                placeholder="AccessKey ID"
                value={form.s3.accessKeyId}
                onChangeText={(v) => patch((d) => ({ ...d, s3: { ...d.s3, accessKeyId: v } }))}
                autoCapitalize="none"
                p={p}
              />
              <Field
                label="Secret Access Key"
                placeholder="Secret Access Key（不落明文）"
                value={s3Secret}
                onChangeText={(v) => {
                  setS3Secret(v);
                  setDirty(true);
                }}
                secureTextEntry
                p={p}
              />
            </>
          )}

          <Text style={styles.rowLabel}>后台同步间隔</Text>
          <View style={styles.optionRow}>
            {INTERVAL_OPTIONS.map((minutes) => (
              <Pressable
                key={minutes}
                onPress={() => patch((d) => ({ ...d, backgroundSyncMinutes: minutes }))}
                style={[styles.option, form.backgroundSyncMinutes === minutes && styles.optionActive]}
              >
                <Text
                  style={[styles.optionText, form.backgroundSyncMinutes === minutes && styles.optionTextActive]}
                >
                  {minutes} 分钟
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.sectionTitle}>操作</Text>
        <View style={styles.card}>
          <View style={styles.buttonRow}>
            <Pressable style={[styles.button, testing && styles.buttonDisabled]} onPress={() => void handleTest()} disabled={testing}>
              {testing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.buttonText}>测试连接</Text>}
            </Pressable>
            <Pressable style={[styles.button, syncing && styles.buttonDisabled]} onPress={() => void handleSyncNow()} disabled={syncing}>
              {syncing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.buttonText}>立即同步</Text>}
            </Pressable>
          </View>
          {testResult ? (
            <Text style={testResult.startsWith('连接成功') ? styles.successText : styles.errorText}>{testResult}</Text>
          ) : null}
          {dirty ? (
            <Pressable style={[styles.button, styles.saveButton]} onPress={() => void persist()}>
              <Text style={styles.buttonText}>保存设置</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>设备标识</Text>
            <Text style={styles.aboutValue}>{getDeviceId()}</Text>
          </View>
          <Text style={styles.aboutNote}>
            凭据经由系统安全硬件（Android Keystore / iOS Keychain）保护，不会明文写入数据库或日志。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize,
  keyboardType,
  p,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences';
  keyboardType?: 'default' | 'url';
  p: ShellPalette;
}) {
  return (
    <View style={fieldStyles.wrap}>
      <Text style={[fieldStyles.label, { color: p.secondaryText }]}>{label}</Text>
      <TextInput
        style={[fieldStyles.input, { color: p.text, borderColor: p.border, backgroundColor: p.background }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={p.secondaryText}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
      />
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
});

function buildBackendFromForm(form: SyncSettings, webdavPassword: string, s3Secret: string) {
  if (form.backendType === 'webdav') {
    return new WebDavBackend({
      serverUrl: form.webdav.serverUrl,
      username: form.webdav.username,
      password: webdavPassword,
      allowHttp: form.webdav.allowHttp,
    });
  }
  return new S3Backend({
    endpoint: form.s3.endpoint,
    bucket: form.s3.bucket,
    basePrefix: form.s3.basePrefix,
    accessKeyId: form.s3.accessKeyId,
    secretAccessKey: s3Secret,
  });
}

const makeStyles = (p: ShellPalette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: p.background,
    },
    content: {
      padding: 16,
      paddingBottom: 48,
    },
    card: {
      backgroundColor: p.surface,
      borderRadius: 12,
      padding: 14,
      marginBottom: 16,
    },
    sectionTitle: {
      color: p.secondaryText,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    flex1: {
      flex: 1,
      marginRight: 12,
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
    statusText: {
      color: p.secondaryText,
      fontSize: 13,
      marginTop: 2,
    },
    warningText: {
      color: '#B8860B',
      fontSize: 12,
      marginTop: 2,
    },
    errorText: {
      color: p.danger,
      fontSize: 13,
      marginTop: 6,
    },
    successText: {
      color: '#209E35',
      fontSize: 13,
      marginTop: 6,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 10,
    },
    button: {
      flex: 1,
      backgroundColor: p.accent,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      flexDirection: 'row',
      gap: 8,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    saveButton: {
      marginTop: 10,
    },
    buttonText: {
      color: '#FFFFFF',
      fontSize: 15,
      fontWeight: '600',
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
      lineHeight: 18,
      marginTop: 6,
    },
  });
