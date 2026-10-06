// 应用锁解锁屏：PIN 输入 + 可选生物识别，覆盖整个应用
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { lockStore } from '../stores/lockStore';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../services/pin';
import type { ShellPalette } from '../constants/theme';
import { useShellPalette } from '../hooks/use-shell';
import { SPACING, RADII, FONT, LINE_HEIGHT } from '../constants/metrics';

export function LockScreen() {
  const p = useShellPalette();
  const styles = useMemo(() => makeStyles(p), [p]);
  const inputRef = useRef<TextInput>(null);

  const biometricEnabled = lockStore((s) => s.biometricEnabled);
  const biometricAvailable = lockStore((s) => s.biometricAvailable);
  const unlockWithPinAsync = lockStore((s) => s.unlockWithPinAsync);
  const unlockWithBiometricAsync = lockStore((s) => s.unlockWithBiometricAsync);

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // PIN 启用了生物识别时，进入锁屏自动弹一次系统验证（异步，避免 effect 内同步 setState）
  useEffect(() => {
    if (biometricEnabled && biometricAvailable) {
      void unlockWithBiometricAsync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 冷启动时 autoFocus 时序不稳，延迟聚焦确保键盘弹出
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  const handleBiometric = async () => {
    setBusy(true);
    await unlockWithBiometricAsync();
    setBusy(false);
  };

  const submitPin = async (value: string) => {
    if (value.length < PIN_MIN_LENGTH || busy) return;
    setBusy(true);
    const ok = await unlockWithPinAsync(value);
    setBusy(false);
    if (ok) {
      setPin('');
      setError(null);
    } else {
      setError('PIN 不正确，请重试');
      setPin('');
    }
  };

  return (
    <View style={styles.safe}>
      <View style={styles.body}>
        <Ionicons name="lock-closed" size={40} color={p.accent} />
        <Text style={styles.title}>便签已锁定</Text>
        <Text style={styles.subtitle}>输入 PIN 解锁</Text>
        <TextInput
          ref={inputRef}
          style={[styles.pinInput, error ? styles.pinInputError : null]}
          value={pin}
          onChangeText={(text) => {
            setPin(text.replace(/\D/g, ''));
            setError(null);
          }}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={PIN_MAX_LENGTH}
          autoFocus
          onSubmitEditing={() => void submitPin(pin)}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} disabled={busy} onPress={() => void submitPin(pin)}>
          <Text style={styles.buttonText}>解锁</Text>
        </Pressable>
        {biometricEnabled && biometricAvailable ? (
          <Pressable style={styles.biometricButton} disabled={busy} onPress={() => void handleBiometric()}>
            <Ionicons name="finger-print" size={22} color={p.accent} />
            <Text style={styles.biometricText}>使用生物识别解锁</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (p: ShellPalette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      backgroundColor: p.background,
    },
    body: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: SPACING.xxl,
    },
    title: {
      color: p.text,
      fontSize: FONT.headline,
      lineHeight: LINE_HEIGHT.headline,
      fontWeight: '700',
      marginTop: SPACING.lg,
    },
    subtitle: {
      color: p.secondaryText,
      fontSize: FONT.body,
      lineHeight: LINE_HEIGHT.body,
      marginTop: SPACING.xs + 2,
      marginBottom: SPACING.xl,
    },
    pinInput: {
      width: 160,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: RADII.md,
      backgroundColor: p.surface,
      color: p.text,
      fontSize: FONT.display,
      lineHeight: LINE_HEIGHT.display,
      letterSpacing: 10,
      textAlign: 'center',
      paddingVertical: 10,
    },
    pinInputError: {
      borderColor: p.danger,
    },
    error: {
      color: p.danger,
      fontSize: FONT.label,
      lineHeight: LINE_HEIGHT.label,
      marginTop: SPACING.md - 2,
    },
    button: {
      backgroundColor: p.accent,
      borderRadius: RADII.md,
      alignItems: 'center',
      paddingHorizontal: SPACING.xxl + 8,
      paddingVertical: SPACING.md,
      marginTop: SPACING.xl - 4,
    },
    buttonText: {
      color: p.onAccent,
      fontSize: FONT.bodyLg,
      lineHeight: LINE_HEIGHT.bodyLg,
      fontWeight: '600',
    },
    biometricButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACING.xs + 2,
      marginTop: SPACING.xl,
      paddingVertical: SPACING.sm,
      paddingHorizontal: SPACING.md,
    },
    biometricText: {
      color: p.accent,
      fontSize: FONT.body,
      lineHeight: LINE_HEIGHT.body,
    },
  });
