// 应用锁状态：启用/修改/清除 PIN、生物识别开关、锁定与解锁
// 锁定规则：启用 PIN 后应用冷启动总是锁定；热切换后台的超时重锁见 autoLockMinutes（批次 4）
import { create } from 'zustand';

import {
  authenticateBiometricAsync,
  clearPinAsync,
  isBiometricAvailableAsync,
  loadPinRecordAsync,
  savePinAsync,
  setBiometricFlagAsync,
  verifyPinAsync,
} from '../services/pin';
import { logger } from '../services/logger';

interface LockState {
  pinEnabled: boolean;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  /** 水合完成前 UI 应保持空屏，避免 PIN 校验前泄露内容 */
  hydrated: boolean;
  locked: boolean;
  hydrate: () => Promise<void>;
  enablePinAsync: (pin: string) => Promise<void>;
  clearPinAsync: () => Promise<void>;
  setBiometricAsync: (enabled: boolean) => Promise<void>;
  unlockWithPinAsync: (pin: string) => Promise<boolean>;
  unlockWithBiometricAsync: () => Promise<boolean>;
}

export const lockStore = create<LockState>((set, get) => ({
  pinEnabled: false,
  biometricEnabled: false,
  biometricAvailable: false,
  hydrated: false,
  locked: false,

  hydrate: async () => {
    const record = await loadPinRecordAsync();
    const biometricAvailable = record?.biometric ? await isBiometricAvailableAsync() : false;
    set({
      pinEnabled: record !== null,
      biometricEnabled: record?.biometric === true,
      biometricAvailable,
      // 启用了 PIN 就从锁定态开始：进程被杀重启也无法绕过
      locked: record !== null,
      hydrated: true,
    });
  },

  enablePinAsync: async (pin) => {
    await savePinAsync(pin, false);
    set({
      pinEnabled: true,
      biometricEnabled: false,
      biometricAvailable: await isBiometricAvailableAsync(),
      locked: false,
    });
  },

  clearPinAsync: async () => {
    await clearPinAsync();
    set({ pinEnabled: false, biometricEnabled: false, locked: false });
  },

  setBiometricAsync: async (enabled) => {
    await setBiometricFlagAsync(enabled);
    set({
      biometricEnabled: enabled,
      biometricAvailable: enabled ? await isBiometricAvailableAsync() : false,
    });
    if (enabled) logger.info('pin', 'biometric unlock enabled');
  },

  unlockWithPinAsync: async (pin) => {
    const ok = await verifyPinAsync(pin);
    if (ok) set({ locked: false });
    return ok;
  },

  unlockWithBiometricAsync: async () => {
    if (!get().biometricEnabled) return false;
    const ok = await authenticateBiometricAsync();
    if (ok) set({ locked: false });
    return ok;
  },
}));
