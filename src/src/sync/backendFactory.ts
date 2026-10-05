// 根据同步设置 + 安全存储凭据构造存储后端实例
import { getS3SecretAsync, getWebDavPasswordAsync } from '../services/credential';
import { S3Backend } from './backends/s3';
import { WebDavBackend } from './backends/webdav';
import type { IStorageBackend } from './backends/types';
import { loadSyncSettings } from './settings';

/** 设置未启用或配置不完整时返回 null */
export async function createBackendAsync(): Promise<IStorageBackend | null> {
  const settings = loadSyncSettings();
  if (!settings.enabled) return null;

  if (settings.backendType === 'webdav') {
    const { serverUrl, username, allowHttp } = settings.webdav;
    const password = (await getWebDavPasswordAsync()) ?? '';
    if (!serverUrl || !username) return null;
    return new WebDavBackend({ serverUrl, username, password, allowHttp });
  }

  const { endpoint, bucket, basePrefix, accessKeyId } = settings.s3;
  const secretAccessKey = (await getS3SecretAsync()) ?? '';
  if (!endpoint || !bucket || !accessKeyId) return null;
  return new S3Backend({ endpoint, bucket, basePrefix, accessKeyId, secretAccessKey });
}
