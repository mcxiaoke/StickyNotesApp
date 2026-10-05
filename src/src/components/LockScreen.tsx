// 应用锁解锁屏：PIN 输入 + 可选生物识别，覆盖整个应用
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { lockStore } from '../stores/lockStore';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '../services/pin';
import type { ShellPalette } from '../constants/theme';
import { useShellPalette } from '../hooks/use-shell';

export function LockScreen() {
  const p = useShellPalette();
  const styles = makeStyles(p);
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
      padding: 32,
    },
    title: {
      color: p.text,
      fontSize: 20,
      fontWeight: '700',
      marginTop: 16,
    },
    subtitle: {
      color: p.secondaryText,
      fontSize: 14,
      marginTop: 6,
      marginBottom: 24,
    },
    pinInput: {
      width: 160,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 10,
      backgroundColor: p.surface,
      color: p.text,
      fontSize: 22,
      letterSpacing: 10,
      textAlign: 'center',
      paddingVertical: 10,
    },
    pinInputError: {
      borderColor: p.danger,
    },
    error: {
      color: p.danger,
      fontSize: 13,
      marginTop: 10,
    },
    button: {
      backgroundColor: p.accent,
      borderRadius: 10,
      alignItems: 'center',
      paddingHorizontal: 40,
      paddingVertical: 12,
      marginTop: 20,
    },
    buttonText: {
      color: p.onAccent,
      fontSize: 15,
      fontWeight: '600',
    },
    biometricButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 24,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    biometricText: {
      color: p.accent,
      fontSize: 14,
    },
  });
