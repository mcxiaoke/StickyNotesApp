// PIN 管理弹层：启用（新 PIN+确认）/ 修改（当前+新+确认）/ 清除（当前）
// 状态重置由父组件通过 key 重挂载完成，不用 effect 内 setState
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { isValidPin, PIN_MAX_LENGTH } from '../services/pin';
import type { ShellPalette } from '../constants/theme';
import { useShellPalette } from '../hooks/use-shell';

export type PinModalMode = 'enable' | 'change' | 'disable';

const ENABLE_FIELDS = [
  { key: 'pin', label: '新 PIN（4-8 位数字）' },
  { key: 'confirm', label: '确认新 PIN' },
];
const CHANGE_FIELDS = [
  { key: 'current', label: '当前 PIN' },
  { key: 'pin', label: '新 PIN（4-8 位数字）' },
  { key: 'confirm', label: '确认新 PIN' },
];
const DISABLE_FIELDS = [{ key: 'current', label: '当前 PIN' }];

export function PinSetupModal({
  visible,
  mode,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  mode: PinModalMode;
  onClose: () => void;
  /** 返回错误文案表示校验失败（含 PIN 不匹配），null 表示成功 */
  onSubmit: (values: Record<string, string>) => Promise<string | null>;
}) {
  const p = useShellPalette();
  const styles = makeStyles(p);

  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fields = mode === 'enable' ? ENABLE_FIELDS : mode === 'change' ? CHANGE_FIELDS : DISABLE_FIELDS;

  const submit = async () => {
    if (busy) return;
    for (const f of fields) {
      if (!isValidPin(values[f.key] ?? '')) {
        setError('PIN 需为 4-8 位数字');
        return;
      }
    }
    if (values.confirm !== undefined && values.pin !== values.confirm) {
      setError('两次输入的 PIN 不一致');
      return;
    }
    setBusy(true);
    const err = await onSubmit(values);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{mode === 'enable' ? '启用 PIN 锁' : mode === 'change' ? '修改 PIN' : '清除 PIN'}</Text>
          {fields.map((f) => (
            <View key={f.key} style={styles.field}>
              <Text style={styles.label}>{f.label}</Text>
              <TextInput
                style={styles.input}
                value={values[f.key] ?? ''}
                onChangeText={(text) => setValues((v) => ({ ...v, [f.key]: text.replace(/\D/g, '') }))}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={PIN_MAX_LENGTH}
                autoFocus={f.key === fields[0].key}
              />
            </View>
          ))}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.buttonRow}>
            <Pressable style={[styles.button, styles.cancelButton]} onPress={onClose}>
              <Text style={[styles.buttonText, { color: p.text }]}>取消</Text>
            </Pressable>
            <Pressable style={styles.button} disabled={busy} onPress={() => void submit()}>
              <Text style={styles.buttonText}>确定</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (p: ShellPalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: '#00000066',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    sheet: {
      width: '100%',
      backgroundColor: p.surface,
      borderRadius: 16,
      padding: 20,
    },
    title: {
      color: p.text,
      fontSize: 17,
      fontWeight: '700',
      marginBottom: 16,
    },
    field: {
      marginBottom: 12,
    },
    label: {
      color: p.secondaryText,
      fontSize: 13,
      marginBottom: 6,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: 10,
      backgroundColor: p.background,
      color: p.text,
      fontSize: 18,
      letterSpacing: 8,
      textAlign: 'center',
      paddingVertical: 9,
    },
    error: {
      color: p.danger,
      fontSize: 13,
      marginBottom: 8,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 8,
    },
    button: {
      flex: 1,
      backgroundColor: p.accent,
      borderRadius: 10,
      alignItems: 'center',
      paddingVertical: 11,
    },
    cancelButton: {
      backgroundColor: p.border,
    },
    buttonText: {
      color: p.onAccent,
      fontSize: 15,
      fontWeight: '600',
    },
  });
