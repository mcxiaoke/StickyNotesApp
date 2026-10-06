// WebDAV 存储后端（对照桌面端 WebDavBackend.cs）：
// 仅使用 PROPFIND / GET / PUT / DELETE / MKCOL 五个动词，Basic 认证，
// notes/ 集合 404 时 MKCOL 递归自举，服务器拒绝 MKCOL 不视为致命。
import { XMLParser } from 'fast-xml-parser';
import { bytesToBase64 } from '../crypto/base64';
import { utf8Encode } from '../crypto/utf8';
import { describeError, logger } from '../../services/logger';
import { NOTES_PREFIX, noteKey } from '../dto';
import { normalizeUrlInput } from '../protocol';
import { readBodySnippetAsync, stripQuery } from './requestLog';
import { StorageBackendError, type IStorageBackend, type RemoteItem } from './types';

const PROPFIND_BODY =
  '<d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>';

export interface WebDavConfig {
  serverUrl: string;
  username: string;
  password: string;
  allowHttp: boolean;
}

/** 单请求超时：10 秒（测试连接与同步轮次共用，避免网络不可达时长时间挂起） */
const REQUEST_TIMEOUT_MS = 10_000;

export class WebDavBackend implements IStorageBackend {
  private readonly rootUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: WebDavConfig) {
    let base = normalizeUrlInput(config.serverUrl);
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    if (!base.endsWith('/')) base += '/';
    if (!config.allowHttp && base.toLowerCase().startsWith('http:')) {
      throw new StorageBackendError('不允许明文 HTTP：请在设置中开启「允许明文 HTTP」或改用 HTTPS 地址');
    }
    this.rootUrl = base;
    // Basic 认证使用自实现 Base64 + UTF-8 编码（不依赖 btoa，避免 RN Hermes 环境差异）
    this.authHeader = `Basic ${bytesToBase64(utf8Encode(`${config.username}:${config.password}`))}`;
  }

  async listAsync(): Promise<RemoteItem[]> {
    const items = await this.propFindCollectionAsync(this.buildUrl(NOTES_PREFIX), 1);
    if (items) return items;

    // notes/ 不存在：MKCOL 自举后重试一次；仍失败按空集合处理
    await this.ensureFoldersAsync();
    const retried = await this.propFindCollectionAsync(this.buildUrl(NOTES_PREFIX), 1);
    return retried ?? [];
  }

  async getTextAsync(key: string): Promise<string | null> {
    const res = await this.request('GET', this.buildUrl(key));
    if (res.status === 404) return null;
    if (!res.ok) throw await this.errorForStatus('GET', res);
    return res.text();
  }

  async putTextAsync(key: string, content: string): Promise<void> {
    const res = await this.request('PUT', this.buildUrl(key), {
      method: 'PUT',
      body: content,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    if (!res.ok) throw await this.errorForStatus('PUT', res);
  }

  async deleteAsync(key: string): Promise<void> {
    const res = await this.request('DELETE', this.buildUrl(key), { method: 'DELETE' });
    if (res.status === 404) return;
    if (!res.ok) throw await this.errorForStatus('DELETE', res);
  }

  /** PROPFIND 根集合 Depth 0：同时验证可达性、认证与根目录存在 */
  async testAsync(): Promise<void> {
    const res = await this.request('PROPFIND', this.rootUrl, {
      method: 'PROPFIND',
      headers: { Depth: '0' },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) {
      await this.ensureFoldersAsync();
      return;
    }
    if (!res.ok && res.status !== 207) throw await this.errorForStatus('测试连接', res);
  }

  dispose(): void {
    // 无状态连接，无需清理
  }

  // ---- 内部实现 ----

  private buildUrl(key: string): string {
    return `${this.rootUrl}${key}`;
  }

  private async request(
    method: string,
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const started = Date.now();
    // 日志口径不含 Authorization 与查询串；请求体不记内容（仅字节数）
    const label = `${options.method ?? method} ${stripQuery(url)}`;
    const bodyNote = options.body != null ? ` body=${options.body.length}B` : '';
    try {
      // Depth 只在 PROPFIND 有意义，且由调用方显式传入（0 = 探测根，1 = 列集合）。
      // 这里作为缺省值补齐，避免出现两处写入同一头（后者静默覆盖前者）的情况。
      const headers: Record<string, string> = {
        Authorization: this.authHeader,
        ...options.headers,
      };
      if (options.method === 'PROPFIND' && headers['Depth'] == null) {
        headers['Depth'] = '1';
      }
      const res = await fetch(url, {
        method: options.method ?? method,
        headers,
        body: options.body,
        signal: controller.signal,
      });
      const elapsed = `${Date.now() - started}ms`;
      // 请求级日志：所有响应都记（一轮同步请求数有限），非 2xx/207 附服务器响应片段——定位 413 这类问题的关键
      if (res.ok || res.status === 207) {
        logger.debug('webdav', `${label}${bodyNote} -> ${res.status} (${elapsed})`);
      } else {
        const snippet = await readBodySnippetAsync(res);
        logger.debug('webdav', `${label}${bodyNote} -> ${res.status} (${elapsed}) body=${snippet || '<empty>'}`);
      }
      return res;
    } catch (ex) {
      // 网络层异常（超时/断网/TLS 等）；AbortError 即 10 秒超时
      logger.warn('webdav', `${label}${bodyNote} failed after ${Date.now() - started}ms: ${describeError(ex)}`);
      throw ex;
    } finally {
      clearTimeout(timer);
    }
  }

  /** PROPFIND 指定集合；404 返回 null，其他错误抛异常 */
  private async propFindCollectionAsync(url: string, depth: 0 | 1): Promise<RemoteItem[] | null> {
    const res = await this.request('PROPFIND', url, {
      method: 'PROPFIND',
      headers: { Depth: String(depth) },
      body: PROPFIND_BODY,
    });
    if (res.status === 404) return null;
    if (res.status !== 207 && !res.ok) throw await this.errorForStatus('PROPFIND', res);

    const text = await res.text();
    let responseNodes: Record<string, unknown>[];
    try {
      const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: true });
      const doc = parser.parse(text) as Record<string, unknown>;
      const multistatus = doc['multistatus'] as Record<string, unknown> | undefined;
      let raw = multistatus?.['response'] ?? doc['response'];
      if (!raw) raw = [];
      responseNodes = Array.isArray(raw) ? raw : [raw as Record<string, unknown>];
    } catch (ex) {
      // 保留原始异常与响应片段再抛，否则"不是合法 XML"无法定位
      logger.warn('webdav', `PROPFIND XML parse failed: ${describeError(ex)}; body=${text.slice(0, 200)}`);
      throw new StorageBackendError('WebDAV PROPFIND 响应不是合法 XML');
    }

    const items: RemoteItem[] = [];
    for (const node of responseNodes) {
      const href = String(node['href'] ?? '');
      if (!href) continue;
      const prop = propStatProp(node);
      if (prop?.['resourcetype'] && typeof prop['resourcetype'] === 'object' && 'collection' in (prop['resourcetype'] as object)) {
        continue; // 集合（目录）跳过
      }

      // 从 href 提取 notes/ 之后的相对 key（href 可能是完整 URL 或绝对路径）
      let decoded = href;
      try {
        decoded = decodeURIComponent(href);
      } catch {
        // 保持原样
      }
      const idx = decoded.toLowerCase().lastIndexOf(`/${NOTES_PREFIX}`);
      if (idx < 0) continue;
      const name = decoded.slice(idx + 1 + NOTES_PREFIX.length);
      if (!name.toLowerCase().endsWith('.json') || name.includes('/')) continue;

      const lastModifiedRaw = prop?.['getlastmodified'];
      const sizeRaw = prop?.['getcontentlength'];
      items.push({
        key: noteKey(name.slice(0, -'.json'.length)),
        size: sizeRaw != null && !Number.isNaN(Number(sizeRaw)) ? Number(sizeRaw) : undefined,
        lastModified:
          typeof lastModifiedRaw === 'string' && !Number.isNaN(Date.parse(lastModifiedRaw))
            ? new Date(Date.parse(lastModifiedRaw)).toISOString()
            : undefined,
      });
    }
    return items;
  }

  /** 先保证根存在，再建 notes/ 子集合；405/409/403 视为已存在或不可创建 */
  private async ensureFoldersAsync(): Promise<void> {
    await this.mkColAsync(this.rootUrl);
    await this.mkColAsync(this.buildUrl(NOTES_PREFIX));
  }

  private async mkColAsync(url: string): Promise<void> {
    try {
      const res = await this.request('MKCOL', url, { method: 'MKCOL' });
      if (
        res.status === 405 ||
        res.status === 409 ||
        res.status === 403 ||
        res.status === 301 ||
        res.status === 302
      ) {
        return; // 已存在或服务器禁止，下一轮重试
      }
      if (!res.ok && res.status !== 201) {
        throw new StorageBackendError(`MKCOL 失败: HTTP ${res.status}`);
      }
    } catch (ex) {
      if (ex instanceof StorageBackendError) throw ex;
      // 网络层异常交由上层统一处理
      throw ex;
    }
  }

  /**
   * 构造存储后端错误（401/403 有针对性提示），错误消息附服务器响应片段
   * （如 413 的配额说明），统一由调用处 throw。
   */
  private async errorForStatus(operation: string, res: Response): Promise<StorageBackendError> {
    const status = res.status;
    const snippet = await readBodySnippetAsync(res, 200);
    const detail = snippet ? `：${snippet}` : '';
    if (status === 401) {
      return new StorageBackendError(`认证失败（401）：请检查用户名与应用专用密码${detail}`, status);
    }
    if (status === 403) {
      return new StorageBackendError(`访问被拒绝（403）：请检查账号权限${detail}`, status);
    }
    return new StorageBackendError(`${operation} 失败: HTTP ${status}${detail}`, status);
  }
}

function propStatProp(node: Record<string, unknown>): Record<string, unknown> | null {
  const propstat = node['propstat'];
  if (!propstat) return null;
  const list = Array.isArray(propstat) ? propstat : [propstat as Record<string, unknown>];
  for (const ps of list) {
    const status = String(ps['status'] ?? '');
    if (status && !status.includes('200')) continue;
    const prop = ps['prop'];
    if (prop && typeof prop === 'object') return prop as Record<string, unknown>;
  }
  const first = list[0]?.['prop'];
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
}
