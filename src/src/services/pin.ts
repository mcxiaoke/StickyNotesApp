// PIN 锁凭据：随机盐 + 单次 SHA-256 + 恒定时间比较。
// 便签正文本身未加密，PIN 仅是 UI 级隐私锁（防君子不防小人），
// 无需慢哈希（PBKDF2 在 Hermes 纯 JS 上 10 万次要 10 秒以上，实测）；
// 盐防彩虹表，哈希经 expo-secure-store 存储（Android Keystore / iOS Keychain），不存明文
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { logger } from './logger';

const KEY = 'app.lock.pin.v1';
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
const SALT_BYTES = 16;

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

function hashPin(pin: string, saltHex: string): string {
  const salt = fromHex(saltHex);
  const pinBytes = new TextEncoder().encode(pin);
  const input = new Uint8Array(salt.length + pinBytes.length);
  input.set(salt, 0);
  input.set(pinBytes, salt.length);
  return toHex(sha256(input));
}

/** 旧版本（PBKDF2）记录的兼容验证；修改 PIN 后即切换为单次 SHA-256 */
function hashPinLegacy(pin: string, saltHex: string, iterations: number): string {
  return toHex(pbkdf2(sha256, new TextEncoder().encode(pin), fromHex(saltHex), { c: iterations, dkLen: 32 }));
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
    if (!parsed?.saltHex || !parsed?.hashHex) {
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
    iterations: 1,
    hashHex: hashPin(pin, saltHex),
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
  const candidate =
    typeof record.iterations === 'number' && record.iterations > 1
      ? hashPinLegacy(pin, record.saltHex, record.iterations)
      : hashPin(pin, record.saltHex);
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
