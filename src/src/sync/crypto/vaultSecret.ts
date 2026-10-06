// 保险箱口令提供器（对照桌面端 VaultSecret.cs）：
// 优先返回本地专属密钥（vaultSecret.local.ts 解混淆），未配置则回落到公开占位口令，
// 保证公开代码在缺少本地密钥时同样可编译、可运行（此时无法与已启用专属密钥的桌面端互通，
// 会被远端 .auth_verifier 探针拦截，属预期行为）。

import { describeError, logger } from '../../services/logger';
import { decodeLocalSecret } from './vaultSecret.local';

/** 公开回落口令（与桌面端 VaultSecret.GetSecret() 的默认值完全一致） */
export const PUBLIC_FALLBACK_SECRET = 'StickyNotes-Vault-Public-Fallback-Key#2026';

let cached: string | null = null;

/** 当前生效的保险箱加密口令（进程内缓存，口令不会在运行期变化） */
export function getVaultSecret(): string {
  if (cached !== null) return cached;

  let local: string | null = null;
  try {
    local = decodeLocalSecret();
  } catch (ex) {
    // 静默回落会让用户在不知情下用了公开口令（无法与桌面端互通），这里补一条可排查记录
    logger.warn('vaultSecret', `local secret decode failed, falling back to public secret: ${describeError(ex)}`);
    local = null;
  }
  cached = local && local.length > 0 ? local : PUBLIC_FALLBACK_SECRET;
  return cached;
}

/** 是否在使用本地专属密钥（用于设置页/诊断展示） */
export function isUsingLocalSecret(): boolean {
  return getVaultSecret() !== PUBLIC_FALLBACK_SECRET;
}
