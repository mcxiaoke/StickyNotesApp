// 最小 AWS Signature V4 签名器（对照桌面端 SigV4Signer.cs 翻译，方案 §4.4）。
// 只覆盖本应用用到的形态：path-style S3 请求 + host;x-amz-content-sha256;x-amz-date 三个签名头。
// region 可为 "auto"（R2 约定）。签名库使用纯 TS 的 @noble/hashes。
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const SIGNED_HEADERS = 'host;x-amz-content-sha256;x-amz-date';

export interface SigV4Result {
  authorization: string;
  xAmzDate: string;
  payloadSha256: string;
}

export interface SigV4Params {
  method: string;
  url: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  /** 请求 body；缺省视为空负载（GET/DELETE） */
  payload?: Uint8Array;
  /** 覆盖签名时间（默认当前 UTC），测试向量需要固定时间 */
  now?: Date;
}

/** 带载荷签名：返回 Authorization 与必须随请求携带的 x-amz-* 头 */
export function signRequest(params: SigV4Params): SigV4Result {
  const payload = params.payload;
  const payloadSha256 =
    !payload || payload.length === 0 ? EMPTY_PAYLOAD_SHA256 : bytesToHex(sha256(payload));

  const now = params.now ?? new Date();
  const dateStamp = formatStamp(now, false);
  const xAmzDate = formatStamp(now, true);

  const uri = new URL(params.url);
  const canonicalUri = canonicalUriOf(uri);
  const canonicalQuery = canonicalQueryOf(uri.search);
  const canonicalHeaders =
    `host:${canonicalHost(uri)}\n` +
    `x-amz-content-sha256:${payloadSha256}\n` +
    `x-amz-date:${xAmzDate}\n`;

  const canonicalRequest = [
    params.method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    SIGNED_HEADERS,
    payloadSha256,
  ].join('\n');

  const scope = `${dateStamp}/${params.region}/${params.service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    xAmzDate,
    scope,
    bytesToHex(sha256(new TextEncoder().encode(canonicalRequest))),
  ].join('\n');

  const signingKey = deriveSigningKey(params.secretKey, dateStamp, params.region, params.service);
  const signature = bytesToHex(hmac(sha256, signingKey, new TextEncoder().encode(stringToSign)));

  const authorization = `${ALGORITHM} Credential=${params.accessKey}/${scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`;
  return { authorization, xAmzDate, payloadSha256 };
}

/** 派生签名密钥（AWS 官方文档算法） */
export function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Uint8Array {
  const kDate = hmac(sha256, new TextEncoder().encode(`AWS4${secretKey}`), new TextEncoder().encode(dateStamp));
  const kRegion = hmac(sha256, kDate, new TextEncoder().encode(region));
  const kService = hmac(sha256, kRegion, new TextEncoder().encode(service));
  return hmac(sha256, kService, new TextEncoder().encode('aws4_request'));
}

/** 规范化 URI：逐段 RFC3986 转义，保留路径分隔符 */
function canonicalUriOf(uri: URL): string {
  const segments = uri.pathname.split('/');
  return segments.map((s) => (s.length === 0 ? '' : rfc3986Escape(s))).join('/');
}

/** 规范化查询串：先解码再按 RFC3986 重编码，按 key 再按 value 字典序排序 */
function canonicalQueryOf(rawQuery: string): string {
  if (!rawQuery || rawQuery === '?') return '';
  const pairs: [string, string][] = [];
  for (const part of rawQuery.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq < 0 ? part : part.slice(0, eq);
    const rawValue = eq < 0 ? '' : part.slice(eq + 1);
    pairs.push([rfc3986Escape(decodeURIComponentSafe(rawKey)), rfc3986Escape(decodeURIComponentSafe(rawValue))]);
  }
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

function canonicalHost(uri: URL): string {
  const port = uri.port;
  if (!port) return uri.hostname;
  const isDefault =
    (uri.protocol === 'https:' && port === '443') || (uri.protocol === 'http:' && port === '80');
  return isDefault ? uri.hostname : `${uri.hostname}:${port}`;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** RFC 3986 编码：encodeURIComponent 之外补齐 !'()* 五个保留字符 */
function rfc3986Escape(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function formatStamp(date: Date, withTime: boolean): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  if (!withTime) return `${y}${mo}${d}`;
  const h = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const s = pad(date.getUTCSeconds());
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}
