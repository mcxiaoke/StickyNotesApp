// 云端口令校验探针（对照桌面端 AuthVerifierDto）：<root>/.auth_verifier
// 载荷为固定魔数 STICKYNOTES_AUTH_OK（包在 SN1: 魔数中）加密后的密文。
// 每轮同步前校验：不存在则自举创建；无法解密或内容不符则整轮中止，
// 避免把不匹配密钥的密文逐个解密失败（并防止错误数据落库）。

import { createMagicPayload, unwrapMagicPayload } from './crypto/cryptoHelper';
import type { IStorageBackend } from './backends/types';
import { AUTH_VERIFIER_MAGIC, VERIFIER_KEY } from './protocol';

export interface AuthVerifierDto {
  version: number;
  iv: string;
  payload: string;
}

/** 用当前密钥生成探针文件内容（JSON） */
export function createVerifierJson(secret: string): string {
  const { iv, payload } = createMagicPayload(AUTH_VERIFIER_MAGIC, secret);
  return JSON.stringify({ version: 1, iv, payload } satisfies AuthVerifierDto);
}

/** 校验探针文件；任何解析/解密失败或内容不符均返回 false（永不抛出） */
export function verifyVerifierJson(json: string, secret: string): boolean {
  try {
    const dto = JSON.parse(json) as Partial<AuthVerifierDto>;
    if (!dto || typeof dto.iv !== 'string' || typeof dto.payload !== 'string') return false;
    if (!dto.iv || !dto.payload) return false;
    return unwrapMagicPayload(dto.iv, dto.payload, secret) === AUTH_VERIFIER_MAGIC;
  } catch {
    return false;
  }
}

/**
 * 探针守卫（同步轮次与设置页「测试连接」共用）：
 * · 远端不存在探针 → 自举创建并上传；
 * · 存在但校验失败 → 抛错，由调用方中止整轮同步（绝不逐个解密失败或落库乱码）。
 */
export async function ensureVerifierAsync(backend: IStorageBackend, secret: string): Promise<void> {
  const existing = await backend.getTextAsync(VERIFIER_KEY);
  if (existing == null) {
    await backend.putTextAsync(VERIFIER_KEY, createVerifierJson(secret));
    return;
  }
  if (!verifyVerifierJson(existing, secret)) {
    throw new Error('远端加密保险箱口令校验失败（.auth_verifier 无法解密或密钥不匹配），本轮同步已中止。');
  }
}
