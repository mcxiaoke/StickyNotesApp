// Cloudflare R2 / S3 兼容存储后端（对照桌面端 S3Backend.cs）：
// path-style URL + 最小 SigV4 签名，ListObjectsV2 / GetObject / PutObject / DeleteObject。
import { XMLParser } from 'fast-xml-parser';
import { NOTES_PREFIX, noteKey } from '../dto';
import { signRequest } from '../crypto/sigv4';
import { StorageBackendError, type IStorageBackend, type RemoteItem } from './types';

export interface S3Config {
  endpoint: string; // https://<ACCOUNT_ID>.r2.cloudflarestorage.com
  bucket: string;
  basePrefix: string; // 如 stickynotes/，可为空
  accessKeyId: string;
  secretAccessKey: string;
}

const REGION = 'auto';
const SERVICE = 's3';
const REQUEST_TIMEOUT_MS = 20_000;

export class S3Backend implements IStorageBackend {
  private readonly endpoint: string;
  private readonly notesObjectPrefix: string;

  constructor(private readonly config: S3Config) {
    let base = config.endpoint.trim();
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    while (base.endsWith('/')) base = base.slice(0, -1);
    if (base.toLowerCase().startsWith('http:')) {
      throw new StorageBackendError('S3/R2 Endpoint 必须使用 HTTPS');
    }
    const bucket = config.bucket.trim();
    if (!bucket) throw new StorageBackendError('Bucket 桶名不能为空');
    this.endpoint = base;
    const basePrefix = config.basePrefix.replace(/^\/+/, '');
    this.notesObjectPrefix = basePrefix ? `${basePrefix}/${NOTES_PREFIX}` : NOTES_PREFIX;
  }

  async listAsync(): Promise<RemoteItem[]> {
    const items: RemoteItem[] = [];
    let continuationToken: string | undefined;
    do {
      const params: [string, string][] = [
        ['list-type', '2'],
        ['max-keys', '1000'],
        ['prefix', this.notesObjectPrefix],
      ];
      if (continuationToken) params.push(['continuation-token', continuationToken]);
      const text = await this.requestXml('GET', '/', params);
      const { contents, isTruncated, nextContinuationToken } = parseListBucketResult(text);
      for (const c of contents) {
        const key = c.key;
        if (!key || !key.toLowerCase().endsWith('.json')) continue;
        const name = key.slice(this.notesObjectPrefix.length);
        if (!name || name.includes('/')) continue;
        items.push({
          key: noteKey(name.slice(0, -'.json'.length)),
          size: c.size,
          lastModified: c.lastModified,
        });
      }
      continuationToken = isTruncated ? nextContinuationToken : undefined;
    } while (continuationToken);
    return items;
  }

  async getTextAsync(key: string): Promise<string | null> {
    const res = await this.signedFetch('GET', `/${key}`);
    if (res.status === 404) return null;
    if (!res.ok) this.throwForStatus('GET', res.status);
    return res.text();
  }

  async putTextAsync(key: string, content: string): Promise<void> {
    const res = await this.signedFetch('PUT', `/${key}`, {
      body: content,
      contentType: 'application/json; charset=utf-8',
    });
    if (!res.ok) this.throwForStatus('PUT', res.status);
  }

  async deleteAsync(key: string): Promise<void> {
    const res = await this.signedFetch('DELETE', `/${key}`);
    if (res.status === 404) return;
    if (!res.ok) this.throwForStatus('DELETE', res.status);
  }

  /** ListObjectsV2 max-keys=1：验证 Endpoint / Bucket / 凭据 */
  async testAsync(): Promise<void> {
    await this.requestXml('GET', '/', [
      ['list-type', '2'],
      ['max-keys', '1'],
      ['prefix', this.notesObjectPrefix],
    ]);
  }

  dispose(): void {
    // 无状态连接，无需清理
  }

  // ---- 内部实现 ----

  private objectUrl(objectKey: string, params?: [string, string][]): string {
    let url = `${this.endpoint}/${this.config.bucket.trim()}/${objectKey}`;
    if (params?.length) {
      url += '?' + params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    }
    return url;
  }

  private async signedFetch(
    method: string,
    objectKey: string,
    options: { body?: string; contentType?: string; params?: [string, string][] } = {},
  ): Promise<Response> {
    const url = this.objectUrl(objectKey.replace(/^\/+/, ''), options.params);
    const payload = options.body != null ? new TextEncoder().encode(options.body) : undefined;
    const sig = signRequest({
      method,
      url,
      region: REGION,
      service: SERVICE,
      accessKey: this.config.accessKeyId,
      secretKey: this.config.secretAccessKey,
      payload,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        method,
        headers: {
          Authorization: sig.authorization,
          'x-amz-date': sig.xAmzDate,
          'x-amz-content-sha256': sig.payloadSha256,
          ...(options.contentType ? { 'Content-Type': options.contentType } : {}),
        },
        body: options.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async requestXml(
    method: string,
    objectKey: string,
    params?: [string, string][],
  ): Promise<string> {
    const res = await this.signedFetch(method, objectKey, { params });
    if (!res.ok) this.throwForStatus(method, res.status);
    return res.text();
  }

  private throwForStatus(operation: string, status: number): never {
    if (status === 401 || status === 403) {
      throw new StorageBackendError('认证失败（403）：请检查 AccessKey 与 SecretAccessKey', status);
    }
    if (status === 404) {
      throw new StorageBackendError('Bucket 不存在（404）：请检查 Endpoint 与 Bucket 名称', status);
    }
    throw new StorageBackendError(`${operation} 失败: HTTP ${status}`, status);
  }
}

interface ParsedList {
  contents: { key: string; size?: number; lastModified?: string }[];
  isTruncated: boolean;
  nextContinuationToken?: string;
}

function parseListBucketResult(xml: string): ParsedList {
  const parser = new XMLParser({ ignoreAttributes: true });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = (doc['ListBucketResult'] ?? doc) as Record<string, unknown>;
  const raw = root['Contents'];
  const arr = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
  const contents = arr
    .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
    .map((c) => ({
      key: String(c['Key'] ?? ''),
      size: c['Size'] != null && !Number.isNaN(Number(c['Size'])) ? Number(c['Size']) : undefined,
      lastModified:
        typeof c['LastModified'] === 'string' ? new Date(c['LastModified']).toISOString() : undefined,
    }))
    .filter((c) => c.key);
  return {
    contents,
    isTruncated: String(root['IsTruncated'] ?? 'false').toLowerCase() === 'true',
    nextContinuationToken:
      typeof root['NextContinuationToken'] === 'string'
        ? (root['NextContinuationToken'] as string)
        : undefined,
  };
}
