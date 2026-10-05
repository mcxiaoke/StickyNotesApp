// 端到端防偷窥加密纯函数（逐字节对照桌面端 CryptoHelper.cs）：
//   · AES-256-CBC + PKCS7 填充（noble 的 cbc 默认即 PKCS7，含“整块再补一整块”规则）
//   · Key = SHA-256(UTF-8(secret))
//   · 明文前缀魔数 "SN1:"，用于根除 CBC 伪解密（约 1/256 概率）产生的乱码落库
//   · iv / payload 一律标准 Base64 字符串
//
// 跨平台确定性由桌面端 scripts/crypto_compat/vectors.json（NIST KAT + 应用用例）交叉验证。

import { cbc } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { base64ToBytes, bytesToBase64 } from './base64';
import { utf8Decode, utf8Encode } from './utf8';

/** 协议魔数头（与桌面端 CryptoHelper.MagicHeader 一致） */
export const MAGIC_HEADER = 'SN1:';

/** 加密相关失败的统一错误类型（调用方据此计入 skippedInvalid，绝不写库） */
export class SyncCryptoError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SyncCryptoError';
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export interface EncryptedPayload {
  /** IV 的 Base64 */
  iv: string;
  /** 密文的 Base64 */
  payload: string;
}

/** 从口令派生 32 字节 (256-bit) AES 密钥 */
export function deriveKey(secret: string): Uint8Array {
  return sha256(utf8Encode(secret));
}

interface NativeCryptoLike {
  getRandomBytes?: (count: number) => Uint8Array;
}

let nativeCrypto: NativeCryptoLike | null | undefined;

function resolveNativeCrypto(): NativeCryptoLike | null {
  if (nativeCrypto !== undefined) return nativeCrypto;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-crypto') as NativeCryptoLike;
    nativeCrypto = typeof mod?.getRandomBytes === 'function' ? mod : null;
  } catch {
    nativeCrypto = null;
  }
  return nativeCrypto;
}

/** 安全随机字节：优先 expo-crypto 原生实现，测试/Node 环境回落 WebCrypto */
export function randomBytes(count: number): Uint8Array {
  const native = resolveNativeCrypto();
  if (native?.getRandomBytes) {
    try {
      return native.getRandomBytes(count);
    } catch {
      // 原生不可用时继续回落
    }
  }
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!webCrypto?.getRandomValues) throw new SyncCryptoError('当前环境没有可用的安全随机源');
  const out = new Uint8Array(count);
  webCrypto.getRandomValues(out);
  return out;
}

/**
 * 加密纯函数：返回 Base64 的 (iv, payload)。
 * fixedIv 仅用于确定性测试（16 字节）。
 */
export function encrypt(plainText: string, secret: string, fixedIv?: Uint8Array): EncryptedPayload {
  const iv = fixedIv ? Uint8Array.from(fixedIv) : randomBytes(16);
  if (iv.length !== 16) throw new SyncCryptoError('IV 必须为 16 字节');

  const key = deriveKey(secret);
  let cipherBytes: Uint8Array;
  try {
    cipherBytes = cbc(key, iv).encrypt(utf8Encode(plainText));
  } catch (ex) {
    throw new SyncCryptoError('加密失败', ex);
  }
  return { iv: bytesToBase64(iv), payload: bytesToBase64(cipherBytes) };
}

/** 解密纯函数：还原 UTF-8 明文；填充错误/非法密文一律抛 SyncCryptoError */
export function decrypt(ivBase64: string, payloadBase64: string, secret: string): string {
  let iv: Uint8Array;
  let cipherBytes: Uint8Array;
  try {
    iv = base64ToBytes(ivBase64);
    cipherBytes = base64ToBytes(payloadBase64);
  } catch (ex) {
    throw new SyncCryptoError('密文 Base64 解析失败，数据可能已损坏', ex);
  }
  if (iv.length !== 16) throw new SyncCryptoError('IV 长度非法（必须 16 字节）');
  if (cipherBytes.length === 0 || cipherBytes.length % 16 !== 0) {
    throw new SyncCryptoError('密文长度非法（必须为 16 字节整块）');
  }

  const key = deriveKey(secret);
  let plainBytes: Uint8Array;
  try {
    plainBytes = cbc(key, iv).decrypt(cipherBytes);
  } catch (ex) {
    throw new SyncCryptoError('密文解密失败（填充或密文损坏），可能是同步密钥不一致。', ex);
  }

  try {
    return utf8Decode(plainBytes);
  } catch (ex) {
    throw new SyncCryptoError('解密结果不是合法 UTF-8，同步密钥不匹配或数据已损坏。', ex);
  }
}

/** 注入魔数并加密：plaintext = "SN1:" + content */
export function createMagicPayload(
  content: string,
  secret: string,
  fixedIv?: Uint8Array,
): EncryptedPayload {
  return encrypt(MAGIC_HEADER + (content ?? ''), secret, fixedIv);
}

/**
 * 解密并核验魔数：必须以 "SN1:" 开头，通过后剥离魔数返回真实正文。
 * 魔数不符（CBC 伪解密乱码）与解密异常同样抛 SyncCryptoError。
 */
export function unwrapMagicPayload(
  ivBase64: string,
  payloadBase64: string,
  secret: string,
): string {
  const decrypted = decrypt(ivBase64, payloadBase64, secret);
  if (!decrypted.startsWith(MAGIC_HEADER)) {
    throw new SyncCryptoError('解密结果魔数头不匹配（伪解密乱码拦截），同步密钥不匹配或数据已损坏。');
  }
  return decrypted.slice(MAGIC_HEADER.length);
}
