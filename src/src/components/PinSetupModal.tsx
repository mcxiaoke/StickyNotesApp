// PIN 管理弹层：启用（新 PIN+确认）/ 修改（当前+新+确认）/ 清除（当前）
// 状态重置由父组件通过 key 重挂载完成，不用 effect 内 setState
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { isValidPin, PIN_MAX_LENGTH } from '../services/pin';
import type { ShellPalette } from '../constants/theme';
import { useShellPalette } from '../hooks/use-shell';
import { SPACING, RADII, FONT, LINE_HEIGHT } from '../constants/metrics';

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
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  const fields = mode === 'enable' ? ENABLE_FIELDS : mode === 'change' ? CHANGE_FIELDS : DISABLE_FIELDS;

  // Modal 内 autoFocus 不可靠，弹层打开后手动聚焦第一个输入框以拉起键盘
  // fields 引用自模块级常量，稳定不变
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => inputRefs.current[fields[0].key]?.focus(), 300);
      return () => clearTimeout(timer);
    }
  }, [visible, fields]);

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
          {fields.map((f, index) => (
            <View key={f.key} style={styles.field}>
              <Text style={styles.label}>{f.label}</Text>
              <TextInput
                ref={(el) => {
                  inputRefs.current[f.key] = el;
                }}
                style={styles.input}
                value={values[f.key] ?? ''}
                onChangeText={(text) => setValues((v) => ({ ...v, [f.key]: text.replace(/\D/g, '') }))}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={PIN_MAX_LENGTH}
                returnKeyType={index < fields.length - 1 ? 'next' : 'done'}
                onSubmitEditing={() => {
                  const next = fields[index + 1];
                  if (next) inputRefs.current[next.key]?.focus();
                  else void submit();
                }}
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
      backgroundColor: p.scrim,
      alignItems: 'center',
      justifyContent: 'center',
      padding: SPACING.xl,
    },
    sheet: {
      width: '100%',
      backgroundColor: p.surface,
      borderRadius: RADII.lg,
      padding: SPACING.xl - 4,
    },
    title: {
      color: p.text,
      fontSize: FONT.title,
      lineHeight: LINE_HEIGHT.title,
      fontWeight: '700',
      marginBottom: SPACING.lg,
    },
    field: {
      marginBottom: SPACING.md,
    },
    label: {
      color: p.secondaryText,
      fontSize: FONT.label,
      lineHeight: LINE_HEIGHT.label,
      marginBottom: SPACING.xs + 2,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      borderRadius: RADII.md,
      backgroundColor: p.background,
      color: p.text,
      fontSize: 18,
      letterSpacing: 8,
      textAlign: 'center',
      paddingVertical: SPACING.sm + 1,
    },
    error: {
      color: p.danger,
      fontSize: FONT.label,
      lineHeight: LINE_HEIGHT.label,
      marginBottom: SPACING.sm,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: SPACING.md - 2,
      marginTop: SPACING.sm,
    },
    button: {
      flex: 1,
      backgroundColor: p.accent,
      borderRadius: RADII.md,
      alignItems: 'center',
      paddingVertical: SPACING.md - 1,
    },
    cancelButton: {
      backgroundColor: p.border,
    },
    buttonText: {
      color: p.onAccent,
      fontSize: FONT.bodyLg,
      lineHeight: LINE_HEIGHT.bodyLg,
      fontWeight: '600',
    },
  });
