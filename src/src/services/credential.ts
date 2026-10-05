// 凭据安全存储（协议铁律 8）：密码与密钥不得明文落盘，
// 经 expo-secure-store 集成 Android Keystore / iOS Keychain。
import * as SecureStore from 'expo-secure-store';
import { logger } from './logger';

const KEYS = {
  webdavPassword: 'sync.credential.webdav.password',
  s3Secret: 'sync.credential.s3.secret',
} as const;

function describe(ex: unknown): string {
  return ex instanceof Error ? `${ex.name}: ${ex.message}` : String(ex);
}

export async function getWebDavPasswordAsync(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEYS.webdavPassword);
  } catch (ex) {
    logger.warn('credential', `read webdav password failed: ${describe(ex)}`);
    return null;
  }
}

export async function setWebDavPasswordAsync(value: string): Promise<void> {
  if (value) {
    await SecureStore.setItemAsync(KEYS.webdavPassword, value);
  } else {
    await SecureStore.deleteItemAsync(KEYS.webdavPassword);
  }
}

export async function getS3SecretAsync(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEYS.s3Secret);
  } catch (ex) {
    logger.warn('credential', `read s3 secret failed: ${describe(ex)}`);
    return null;
  }
}

export async function setS3SecretAsync(value: string): Promise<void> {
  if (value) {
    await SecureStore.setItemAsync(KEYS.s3Secret, value);
  } else {
    await SecureStore.deleteItemAsync(KEYS.s3Secret);
  }
}
