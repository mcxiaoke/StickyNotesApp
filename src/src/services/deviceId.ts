// 本机设备标识：首启生成并持久化（kv），格式如 android-8xf7ad
import { kvGet, kvSet } from '../data/db';
import { Platform } from 'react-native';
import { generateUuidV4 } from '../data/note';

const KV_KEY = 'sync.deviceId';

export function getDeviceId(): string {
  const existing = kvGet(KV_KEY);
  if (existing) return existing;
  const id = `${Platform.OS}-${generateUuidV4().slice(0, 6)}`;
  kvSet(KV_KEY, id);
  return id;
}
