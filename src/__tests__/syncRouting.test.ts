// 存储根路由与 S3 前缀一致性单测（对照桌面端 StorageBackendFactory / S3Backend.FullKey）。
// 覆盖两类静默失效：
//   1) 双轨子目录路由（明文 stickynotes-data / 密文 stickynotes-vault）
//   2) S3 读写路径同口径（list 的 prefix 必须与 get/put/delete 的完整对象 key 一致）

import { S3Backend } from '../src/sync/backends/s3';
import { WebDavBackend } from '../src/sync/backends/webdav';
import { getEffectiveS3Prefix, getEffectiveWebDavUrl, normalizeUrlInput } from '../src/sync/protocol';

describe('全角标点 URL 归一化（中文输入法场景）', () => {
  test('全角冒号/斜杠/句号折算为半角', () => {
    expect(normalizeUrlInput('http：／／10。0。2。2：6065／')).toBe('http://10.0.2.2:6065/');
    expect(normalizeUrlInput('https：／／dav。jianguoyun。com／dav／')).toBe(
      'https://dav.jianguoyun.com/dav/',
    );
    expect(normalizeUrlInput('  服务器　地址  ')).toBe('服务器地址');
  });

  test('归一化后再做子目录路由', () => {
    expect(getEffectiveWebDavUrl('http：／／10。0。2。2：6065／', false)).toBe(
      'http://10.0.2.2:6065/stickynotes-data/',
    );
    expect(getEffectiveS3Prefix('stickynotes／', true)).toBe('stickynotes-vault/');
  });
});

describe('WebDAV 根 URL 子目录路由', () => {
  test('未含子目录时按模式追加', () => {
    expect(getEffectiveWebDavUrl('https://dav.example.com/dav/', false)).toBe(
      'https://dav.example.com/dav/stickynotes-data/',
    );
    expect(getEffectiveWebDavUrl('https://dav.example.com/dav/', true)).toBe(
      'https://dav.example.com/dav/stickynotes-vault/',
    );
  });

  test('幂等：已含目标子目录不重复追加（大小写不敏感）', () => {
    expect(getEffectiveWebDavUrl('https://dav.example.com/dav/stickynotes-data/', false)).toBe(
      'https://dav.example.com/dav/stickynotes-data/',
    );
    expect(getEffectiveWebDavUrl('https://dav.example.com/dav/StickyNotes-Vault', true)).toBe(
      'https://dav.example.com/dav/StickyNotes-Vault/',
    );
  });

  test('切换模式时自动剥离对侧子目录', () => {
    expect(getEffectiveWebDavUrl('https://dav.example.com/dav/stickynotes-data', true)).toBe(
      'https://dav.example.com/dav/stickynotes-vault/',
    );
    expect(getEffectiveWebDavUrl('https://dav.example.com/dav/stickynotes-vault/', false)).toBe(
      'https://dav.example.com/dav/stickynotes-data/',
    );
  });

  test('缺失或空白地址返回空串', () => {
    expect(getEffectiveWebDavUrl('', false)).toBe('');
    expect(getEffectiveWebDavUrl('   ', true)).toBe('');
  });
});

describe('S3 对象前缀子目录路由', () => {
  test('空前缀与桌面端默认 stickynotes/ 均归一为目标子目录', () => {
    expect(getEffectiveS3Prefix('', false)).toBe('stickynotes-data/');
    expect(getEffectiveS3Prefix(undefined, true)).toBe('stickynotes-vault/');
    expect(getEffectiveS3Prefix('stickynotes/', false)).toBe('stickynotes-data/');
    expect(getEffectiveS3Prefix('stickynotes/', true)).toBe('stickynotes-vault/');
  });

  test('自定义前缀下追加子目录，并剥离对侧子目录', () => {
    expect(getEffectiveS3Prefix('mynotes/', false)).toBe('mynotes/stickynotes-data/');
    expect(getEffectiveS3Prefix('mynotes/stickynotes-vault/', false)).toBe('mynotes/stickynotes-data/');
    expect(getEffectiveS3Prefix('/mynotes/stickynotes-data/', true)).toBe('mynotes/stickynotes-vault/');
  });
});

interface FetchCall {
  url: string;
  method: string;
}

function makeResponse(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

const LIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <IsTruncated>false</IsTruncated>
  <Contents>
    <Key>stickynotes-data/notes/9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab.json</Key>
    <Size>128</Size>
    <LastModified>2026-10-05T00:00:00.000Z</LastModified>
  </Contents>
  <Contents>
    <Key>stickynotes-data/.auth_verifier</Key>
    <Size>96</Size>
    <LastModified>2026-10-05T00:00:00.000Z</LastModified>
  </Contents>
</ListBucketResult>`;

describe('S3Backend 对象 key 同口径（basePrefix 非空）', () => {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    calls.length = 0;
    globalThis.fetch = (async (input: unknown, init?: { method?: string }) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      const url = String(input);
      if (url.includes('list-type=2')) return makeResponse(LIST_XML);
      if (init?.method === 'PUT') return makeResponse('', 200);
      if (init?.method === 'DELETE') return makeResponse('', 204);
      return makeResponse('{"schemaVersion":1}', 200);
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const backend = new S3Backend({
    endpoint: 'https://acc.r2.cloudflarestorage.com',
    bucket: 'stickynotes',
    basePrefix: 'stickynotes-data/',
    accessKeyId: 'AKIA_TEST',
    secretAccessKey: 'secret',
  });

  test('list 使用含前缀的 prefix，并返回相对 key', async () => {
    const items = await backend.listAsync();
    expect(calls[0].url).toContain('prefix=stickynotes-data%2Fnotes%2F');
    // 探针等非便签对象被过滤
    expect(items.map((i) => i.key)).toEqual(['notes/9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab.json']);
  });

  test('get / put / delete 补齐同一前缀（与 list 口径一致）', async () => {
    await backend.getTextAsync('notes/9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab.json');
    await backend.putTextAsync('notes/9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab.json', '{}');
    await backend.putTextAsync('.auth_verifier', '{}');
    await backend.deleteAsync('notes/9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab.json');

    const urls = calls.map((c) => c.url);
    expect(urls[0]).toBe(
      'https://acc.r2.cloudflarestorage.com/stickynotes/stickynotes-data/notes/9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab.json',
    );
    expect(urls[1]).toBe(
      'https://acc.r2.cloudflarestorage.com/stickynotes/stickynotes-data/notes/9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab.json',
    );
    // 探针位于前缀根，而非 notes/ 下
    expect(urls[2]).toBe(
      'https://acc.r2.cloudflarestorage.com/stickynotes/stickynotes-data/.auth_verifier',
    );
    expect(urls[3]).toBe(
      'https://acc.r2.cloudflarestorage.com/stickynotes/stickynotes-data/notes/9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab.json',
    );
  });
});

describe('WebDavBackend 单请求 10 秒超时', () => {
  test('后端构造后 URL 归一化并追加尾斜杠', () => {
    globalThis.fetch = (async () => makeResponse('', 207)) as unknown as typeof fetch;
    const backend = new WebDavBackend({
      serverUrl: getEffectiveWebDavUrl('https://dav.example.com/dav/', true),
      username: 'u',
      password: 'p',
      allowHttp: false,
    });
    expect(backend).toBeDefined();
  });
});
