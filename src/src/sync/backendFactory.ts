// 根据同步设置 + 安全存储凭据构造存储后端实例。
// 存储根按 enableEncryption 自动路由到双轨子目录（stickynotes-data / stickynotes-vault），
// 与桌面端 StorageBackendFactory 完全一致；后端内部 key 一律为 notes/<uuid>.json 与 .auth_verifier。
import { getS3SecretAsync, getWebDavPasswordAsync } from '../services/credential';
import { S3Backend } from './backends/s3';
import { WebDavBackend } from './backends/webdav';
import type { IStorageBackend } from './backends/types';
import { getEffectiveS3Prefix, getEffectiveWebDavUrl } from './protocol';
import { loadSyncSettings } from './settings';

/** 设置未启用或配置不完整时返回 null */
export async function createBackendAsync(): Promise<IStorageBackend | null> {
  const settings = loadSyncSettings();
  if (!settings.enabled) return null;

  if (settings.backendType === 'webdav') {
    const { serverUrl, username, allowHttp } = settings.webdav;
    if (!serverUrl || !username) return null;
    const effectiveUrl = getEffectiveWebDavUrl(serverUrl, settings.enableEncryption);
    if (!effectiveUrl) return null;
    const password = (await getWebDavPasswordAsync()) ?? '';
    return new WebDavBackend({ serverUrl: effectiveUrl, username, password, allowHttp });
  }

  const { endpoint, bucket, basePrefix, accessKeyId } = settings.s3;
  if (!endpoint || !bucket || !accessKeyId) return null;
  const secretAccessKey = (await getS3SecretAsync()) ?? '';
  return new S3Backend({
    endpoint,
    bucket,
    basePrefix: getEffectiveS3Prefix(basePrefix, settings.enableEncryption),
    accessKeyId,
    secretAccessKey,
  });
}
