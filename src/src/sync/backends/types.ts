// 存储后端抽象（方案 §4.4）：SyncEngine 只依赖此接口

export interface RemoteItem {
  key: string;
  size?: number;
  lastModified?: string; // ISO-8601 原始字符串
}

export interface IStorageBackend {
  listAsync(): Promise<RemoteItem[]>;
  getTextAsync(key: string): Promise<string | null>;
  putTextAsync(key: string, content: string): Promise<void>;
  deleteAsync(key: string): Promise<void>;
  testAsync(): Promise<void>;
  dispose(): void;
}

export class StorageBackendError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'StorageBackendError';
  }
}
