// Cloudflare R2 / S3 兼容存储后端（对照桌面端 S3Backend.cs）：
// path-style URL + 最小 SigV4 签名，ListObjectsV2 / GetObject / PutObject / DeleteObject。
import { XMLParser } from 'fast-xml-parser';
import { describeError, logger } from '../../services/logger';
import { NOTES_PREFIX, noteKey } from '../dto';
import { normalizeUrlInput } from '../protocol';
import { signRequest } from '../crypto/sigv4';
import { readBodySnippetAsync, stripQuery } from './requestLog';
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
/** 单请求超时：10 秒（测试连接与同步轮次共用，避免网络不可达时长时间挂起） */
const REQUEST_TIMEOUT_MS = 10_000;

export class S3Backend implements IStorageBackend {
  private readonly endpoint: string;
  /** 归一化后的对象前缀（含尾斜杠；空串表示桶根） */
  private readonly basePrefix: string;
  private readonly notesObjectPrefix: string;

  constructor(private readonly config: S3Config) {
    let base = normalizeUrlInput(config.endpoint);
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    while (base.endsWith('/')) base = base.slice(0, -1);
    if (base.toLowerCase().startsWith('http:')) {
      throw new StorageBackendError('S3/R2 Endpoint 必须使用 HTTPS');
    }
    const bucket = config.bucket.trim();
    if (!bucket) throw new StorageBackendError('Bucket 桶名不能为空');
    this.endpoint = base;
    const basePrefix = config.basePrefix.replace(/^\/+/, '').replace(/\/+$/, '');
    this.basePrefix = basePrefix ? `${basePrefix}/` : '';
    this.notesObjectPrefix = `${this.basePrefix}${NOTES_PREFIX}`;
  }

  /**
   * 相对 key（"notes/x.json"）→ 完整对象 key（"{basePrefix}notes/x.json"）。
   * 必须与桌面端 S3Backend.FullKey 一致：listAsync 的 prefix 与 get/put/delete 的路径
   * 口径若不一致，会出现“写进去的对象永远列不出来”的静默失效。
   */
  private fullKey(key: string): string {
    return `${this.basePrefix}${key.replace(/^\/+/, '')}`;
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
    const res = await this.signedFetch('GET', `/${this.fullKey(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw await this.errorForStatus('GET', res);
    return res.text();
  }

  async putTextAsync(key: string, content: string): Promise<void> {
    const res = await this.signedFetch('PUT', `/${this.fullKey(key)}`, {
      body: content,
      contentType: 'application/json; charset=utf-8',
    });
    if (!res.ok) throw await this.errorForStatus('PUT', res);
  }

  async deleteAsync(key: string): Promise<void> {
    const res = await this.signedFetch('DELETE', `/${this.fullKey(key)}`);
    if (res.status === 404) return;
    if (!res.ok) throw await this.errorForStatus('DELETE', res);
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
    const started = Date.now();
    // 日志口径不含 Authorization 与查询串；请求体不记内容（仅字节数）
    const label = `${method} ${stripQuery(url)}`;
    const bodyNote = options.body != null ? ` body=${options.body.length}B` : '';
    try {
      const res = await fetch(url, {
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
      const elapsed = `${Date.now() - started}ms`;
      // 请求级日志：所有响应都记（一轮同步请求数有限），非 2xx 附服务器响应片段（S3 错误 XML 含具体原因）
      if (res.ok) {
        logger.debug('s3', `${label}${bodyNote} -> ${res.status} (${elapsed})`);
      } else {
        const snippet = await readBodySnippetAsync(res);
        logger.debug('s3', `${label}${bodyNote} -> ${res.status} (${elapsed}) body=${snippet || '<empty>'}`);
      }
      return res;
    } catch (ex) {
      // 网络层异常（超时/断网/TLS 等）；AbortError 即 10 秒超时
      logger.warn('s3', `${label}${bodyNote} failed after ${Date.now() - started}ms: ${describeError(ex)}`);
      throw ex;
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
    if (!res.ok) throw await this.errorForStatus(method, res);
    return res.text();
  }

  /**
   * 构造存储后端错误（401/403/404 有针对性提示），错误消息附服务器响应片段
   * （S3 错误 XML 的 <Message>/Code），统一由调用处 throw。
   */
  private async errorForStatus(operation: string, res: Response): Promise<StorageBackendError> {
    const status = res.status;
    const snippet = await readBodySnippetAsync(res, 200);
    const detail = snippet ? `：${snippet}` : '';
    if (status === 401 || status === 403) {
      return new StorageBackendError(`认证失败（403）：请检查 AccessKey 与 SecretAccessKey${detail}`, status);
    }
    if (status === 404) {
      return new StorageBackendError(`Bucket 不存在（404）：请检查 Endpoint 与 Bucket 名称${detail}`, status);
    }
    return new StorageBackendError(`${operation} 失败: HTTP ${status}${detail}`, status);
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
