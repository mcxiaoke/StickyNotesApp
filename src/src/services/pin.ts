// PIN 锁凭据：PBKDF2-SHA256 + 随机盐 + 恒定时间比较（对齐桌面端 PinService 语义），
// 盐与哈希经 expo-secure-store 存储（Android Keystore / iOS Keychain），不存明文
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { logger } from './logger';

const KEY = 'app.lock.pin.v1';
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DK_LEN = 32;

export interface PinRecord {
  saltHex: string;
  iterations: number;
  hashHex: string;
  biometric: boolean;
  createdAt: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function getRandomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  // 与 note.ts 同策略：expo-crypto 优先，测试/node 环境退回全局 crypto
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as { getRandomValues?: (a: Uint8Array) => Uint8Array };
  if (typeof Crypto?.getRandomValues === 'function') return Crypto.getRandomValues(bytes);
  return globalThis.crypto.getRandomValues(bytes);
}

function hashPin(pin: string, saltHex: string, iterations: number): string {
  return toHex(pbkdf2(sha256, new TextEncoder().encode(pin), fromHex(saltHex), { c: iterations, dkLen: DK_LEN }));
}

/** 恒定时间字符串比较（两侧等长 hex），避免比较时序侧信道 */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

export async function loadPinRecordAsync(): Promise<PinRecord | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PinRecord;
    // 完整性校验：字段缺失即视为损坏，绝不静默降级（对齐桌面端告警语义）
    if (!parsed?.saltHex || !parsed?.hashHex || typeof parsed?.iterations !== 'number') {
      logger.warn('pin', 'corrupted pin record detected, lock disabled');
      return null;
    }
    return { ...parsed, biometric: parsed.biometric === true };
  } catch (ex) {
    logger.warn('pin', `load pin record failed: ${ex instanceof Error ? ex.message : String(ex)}`);
    return null;
  }
}

export async function savePinAsync(pin: string, biometric: boolean): Promise<void> {
  const saltHex = toHex(getRandomBytes(SALT_BYTES));
  const record: PinRecord = {
    saltHex,
    iterations: ITERATIONS,
    hashHex: hashPin(pin, saltHex, ITERATIONS),
    biometric,
    createdAt: new Date().toISOString(),
  };
  await SecureStore.setItemAsync(KEY, JSON.stringify(record));
  logger.info('pin', 'pin record saved');
}

export async function setBiometricFlagAsync(biometric: boolean): Promise<void> {
  const record = await loadPinRecordAsync();
  if (!record) return;
  await SecureStore.setItemAsync(KEY, JSON.stringify({ ...record, biometric }));
}

export async function clearPinAsync(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
  logger.info('pin', 'pin record cleared');
}

export async function verifyPinAsync(pin: string): Promise<boolean> {
  const record = await loadPinRecordAsync();
  if (!record) return false;
  const candidate = hashPin(pin, record.saltHex, record.iterations);
  return timingSafeEqualHex(candidate, record.hashHex);
}

// ---- 生物识别可用性 ----

export async function isBiometricAvailableAsync(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch (ex) {
    logger.warn('pin', `biometric check failed: ${ex instanceof Error ? ex.message : String(ex)}`);
    return false;
  }
}

export async function authenticateBiometricAsync(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: '验证指纹或面部以解锁便签',
      cancelLabel: '取消',
    });
    return result.success === true;
  } catch (ex) {
    logger.warn('pin', `biometric auth failed: ${ex instanceof Error ? ex.message : String(ex)}`);
    return false;
  }
}
