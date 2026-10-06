// @ts-nocheck -- 该用例依赖 Node 内置模块（fs / http / https / path）与本地 WebDAV 服务，
// 仅在设置了 WEBDAV_E2E_URL 时手工运行；项目 tsconfig 未启用 Node 类型（避免与 RN 全局类型冲突）。
//
// 本地 WebDAV 端到端集成测试（真实 HTTP，非 mock）。
//
// 需要本地 WebDAV 服务（默认 http://127.0.0.1:6065/，凭据 stickynotes/stickynotes123）：
//   webdav.exe -c temp/webdav-config.yaml        # 见 temp/webdav-config.yaml
// 通过环境变量启用，未设置时整组跳过（CI 上不会误跑）：
//   WEBDAV_E2E_URL=http://127.0.0.1:6065/ npx jest __tests__/syncWebDavE2E.test.ts
//
// 交叉验证使用桌面端真实实现 StickyNotesDesktop/scripts/crypto_compat/nodejs/crypto_helper.js
// （与桌面端 C# CryptoHelper 逐字节一致的参照实现），证明两端互为可解密。

import * as fs from 'fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'path';

import { WebDavBackend } from '../src/sync/backends/webdav';
import { SyncEngine } from '../src/sync/engine';
import { getVaultSecret } from '../src/sync/crypto/vaultSecret';
import { unwrapMagicPayload } from '../src/sync/crypto/cryptoHelper';
import { dtoFromNote, noteKey, serializeDto, type NoteLike } from '../src/sync/dto';
import { getEffectiveWebDavUrl } from '../src/sync/protocol';
import type { INoteRepository, RemoteApplyItem } from '../src/data/noteRepository';

jest.mock('../src/data/noteRepository', () => ({ noteRepository: {} }));

const BASE_URL = process.env.WEBDAV_E2E_URL;
const USERNAME = process.env.WEBDAV_E2E_USER ?? 'stickynotes';
const PASSWORD = process.env.WEBDAV_E2E_PASS ?? 'stickynotes123';
const LOCAL_ROOT = process.env.WEBDAV_E2E_ROOT ?? 'C:/Home/Projects/StickyNotesApp/temp/webdav-root';

const DESKTOP_HELPER =
  process.env.DESKTOP_CRYPTO_HELPER ??
  'C:/Home/Projects/StickyNotesDesktop/scripts/crypto_compat/nodejs/crypto_helper.js';

const describeE2E = BASE_URL ? describe : describe.skip;
const secret = getVaultSecret();

interface DesktopCrypto {
  encrypt(plainText: string, password: string, fixedIv?: unknown): { iv: string; data: string };
  decrypt(ivBase64: string, dataBase64: string, password: string): string;
}

let desktopCrypto: DesktopCrypto | null = null;
try {
  if (fs.existsSync(DESKTOP_HELPER)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    desktopCrypto = require(DESKTOP_HELPER) as DesktopCrypto;
  }
} catch {
  desktopCrypto = null;
}

const DEVICE_MOBILE = 'android-e2e0001';
const DEVICE_DESKTOP = 'win-e2e0001';

/**
 * jest（node 环境）里 react-native 的 fetch polyfill 缺少 XMLHttpRequest，
 * 响应对象的 status 恒为 undefined，无法做真实 HTTP 验证。
 * 这里注入一个基于 node:http 的最小 fetch 适配器，仅覆盖 WebDAV 后端用到的能力
 * （method / headers / body / signal / 2xx 判定），真机运行时仍使用 RN 原生 fetch。
 */
function createNodeFetch(): typeof fetch {
  return ((url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
    new Promise<Response>((resolve, reject) => {
      const target = new URL(url);
      const lib = target.protocol === 'https:' ? https : http;
      const headers: Record<string, string> = { ...(init?.headers ?? {}) };
      if (init?.body != null) headers['Content-Length'] = String(Buffer.byteLength(init.body));

      const req = lib.request(
        {
          method: init?.method ?? 'GET',
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            const body = Buffer.concat(chunks).toString('utf8');
            resolve({
              ok: status >= 200 && status < 300,
              status,
              text: async () => body,
            } as unknown as Response);
          });
        },
      );
      req.on('error', reject);
      if (init?.signal) {
        if (init.signal.aborted) req.destroy(new Error('aborted'));
        else init.signal.addEventListener('abort', () => req.destroy(new Error('aborted')));
      }
      if (init?.body != null) req.write(init.body);
      req.end();
    })) as unknown as typeof fetch;
}

class InMemoryRepo implements INoteRepository {
  notes = new Map<string, NoteLike>();

  async getAllAsync(): Promise<NoteLike[]> {
    return [...this.notes.values()];
  }

  async applyRemoteBatchAsync(items: RemoteApplyItem[]): Promise<{ applied: number; guardedSkipped: number }> {
    let applied = 0;
    let guarded = 0;
    for (const item of items) {
      const current = this.notes.get(item.note.id);
      if (!current) {
        this.notes.set(item.note.id, { ...item.note });
        applied++;
      } else if (item.snapshotUpdatedAt !== null && current.updatedAt === item.snapshotUpdatedAt) {
        this.notes.set(item.note.id, { ...item.note });
        applied++;
      } else {
        guarded++;
      }
    }
    return { applied, guardedSkipped: guarded };
  }
}

function makeNote(partial: Partial<NoteLike> & { id: string }): NoteLike {
  return {
    content: 'content-' + partial.id,
    color: 'yellow',
    isPinnedInList: false,
    alwaysOnTop: false,
    isDeleted: false,
    createdAt: '2026-10-05T02:00:00.0000000Z',
    updatedAt: '2026-10-05T03:00:00.0000000Z',
    ...partial,
  };
}

function makeBackend(enableEncryption: boolean): WebDavBackend {
  const url = getEffectiveWebDavUrl(BASE_URL as string, enableEncryption);
  return new WebDavBackend({ serverUrl: url, username: USERNAME, password: PASSWORD, allowHttp: true });
}

function resetRemoteRoot(): void {
  fs.rmSync(LOCAL_ROOT, { recursive: true, force: true });
  fs.mkdirSync(LOCAL_ROOT, { recursive: true });
}

function dataDir(): string {
  return path.join(LOCAL_ROOT, 'stickynotes-data', 'notes');
}

function vaultDir(): string {
  return path.join(LOCAL_ROOT, 'stickynotes-vault', 'notes');
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

describeE2E('本地 WebDAV 端到端（真实 HTTP）', () => {
  beforeAll(() => {
    global.fetch = createNodeFetch();
  });

  beforeEach(() => {
    resetRemoteRoot();
  });

  test('明文模式：上行落 stickynotes-data/，正文为明文，且能被另一设备拉取', async () => {
    const id = '9f3c8a4e-1b2d-4c3e-a5f6-0123456789ab';
    const note = makeNote({ id, content: '明文便签 内容 A' });

    const uploaderRepo = new InMemoryRepo();
    uploaderRepo.notes.set(id, note);
    const summary = await new SyncEngine(uploaderRepo).runAsync(makeBackend(false), DEVICE_MOBILE);
    expect(summary!.uploaded).toBe(1);

    const remoteFile = path.join(dataDir(), `${id}.json`);
    expect(fs.existsSync(remoteFile)).toBe(true);
    const remote = readJson(remoteFile);
    expect(remote['content']).toBe('明文便签 内容 A');
    expect('iv' in remote).toBe(false);
    expect('payload' in remote).toBe(false);
    // 明文模式不产生探针
    expect(fs.existsSync(path.join(LOCAL_ROOT, 'stickynotes-data', '.auth_verifier'))).toBe(false);

    const pullerRepo = new InMemoryRepo();
    const pullSummary = await new SyncEngine(pullerRepo).runAsync(makeBackend(false), DEVICE_DESKTOP);
    expect(pullSummary!.downloaded).toBe(1);
    expect(pullerRepo.notes.get(id)!.content).toBe('明文便签 内容 A');
  });

  test('加密模式：上行落 stickynotes-vault/，远端无 content，探针自举', async () => {
    const id = 'a1b2c3d4-1111-2222-3333-444455556666';
    const repo = new InMemoryRepo();
    repo.notes.set(id, makeNote({ id, content: '机密便签 🔐 中文' }));

    const summary = await new SyncEngine(repo).runAsync(makeBackend(true), DEVICE_MOBILE, {
      enableEncryption: true,
      secret,
    });
    expect(summary!.uploaded).toBe(1);

    const remoteFile = path.join(vaultDir(), `${id}.json`);
    expect(fs.existsSync(remoteFile)).toBe(true);
    const remote = readJson(remoteFile);
    expect('content' in remote).toBe(false);
    expect(typeof remote['iv']).toBe('string');
    expect(typeof remote['payload']).toBe('string');

    // 本地实现可解
    expect(unwrapMagicPayload(remote['iv'] as string, remote['payload'] as string, secret)).toBe(
      '机密便签 🔐 中文',
    );

    // 明文目录不含该便签，双轨物理隔离
    expect(fs.existsSync(path.join(dataDir(), `${id}.json`))).toBe(false);

    // 探针存在且版本正确
    const verifierFile = path.join(LOCAL_ROOT, 'stickynotes-vault', '.auth_verifier');
    expect(fs.existsSync(verifierFile)).toBe(true);
    expect(readJson(verifierFile)['version']).toBe(1);
  });

  test('加密模式：另一台设备（同密钥）可完整拉取解密', async () => {
    const id = 'b1b1b1b1-2222-3333-4444-555566667777';
    const uploaderRepo = new InMemoryRepo();
    uploaderRepo.notes.set(id, makeNote({ id, content: '多行\n内容 📝\r\n第二行' }));

    await new SyncEngine(uploaderRepo).runAsync(makeBackend(true), DEVICE_MOBILE, {
      enableEncryption: true,
      secret,
    });

    const pullerRepo = new InMemoryRepo();
    const summary = await new SyncEngine(pullerRepo).runAsync(makeBackend(true), DEVICE_DESKTOP, {
      enableEncryption: true,
      secret,
    });

    expect(summary!.downloaded).toBe(1);
    expect(summary!.skippedInvalid).toBe(0);
    expect(pullerRepo.notes.get(id)!.content).toBe('多行\n内容 📝\n第二行');
  });

  test('错误密钥被探针拦截，远端对象未被改动', async () => {
    const id = 'c1c1c1c1-3333-4444-5555-666677778888';
    const uploaderRepo = new InMemoryRepo();
    uploaderRepo.notes.set(id, makeNote({ id, content: 'original' }));
    await new SyncEngine(uploaderRepo).runAsync(makeBackend(true), DEVICE_MOBILE, {
      enableEncryption: true,
      secret,
    });
    const before = fs.readFileSync(path.join(vaultDir(), `${id}.json`), 'utf8');

    const attackRepo = new InMemoryRepo();
    attackRepo.notes.set(id, makeNote({ id, content: 'tampered', updatedAt: '2027-01-01T00:00:00.0000000Z' }));
    await expect(
      new SyncEngine(attackRepo).runAsync(makeBackend(true), DEVICE_DESKTOP, {
        enableEncryption: true,
        secret: 'wrong-secret',
      }),
    ).rejects.toThrow(/口令校验失败/);

    // 远端未被覆盖
    expect(fs.readFileSync(path.join(vaultDir(), `${id}.json`), 'utf8')).toBe(before);
    // 攻击端本地库未被写入远端内容
    expect(attackRepo.notes.get(id)!.content).toBe('tampered');
  });

  describe('与桌面端实现交叉验证', () => {
    const maybe = desktopCrypto ? test : test.skip;

    maybe('桌面端加密的便签可被移动端解密入库（同一专属密钥）', async () => {
      const id = 'd1d1d1d1-4444-5555-6666-777788889999';
      const content = '桌面端写入的机密内容 🖥️\n含换行';

      // 桌面端参照实现（node:crypto）加密，含 SN1: 魔数
      const enc = desktopCrypto!.encrypt('SN1:' + content, secret);
      const dto = {
        schemaVersion: 1,
        id,
        iv: enc.iv,
        payload: enc.data,
        color: 'yellow',
        isPinnedInList: false,
        alwaysOnTop: false,
        isDeleted: false,
        createdAt: '2026-10-05T04:00:00.0000000Z',
        updatedAt: '2026-10-05T05:00:00.0000000Z',
        deviceId: DEVICE_DESKTOP,
      };

      const backend = makeBackend(true);
      // 先确保远端目录存在（等价于桌面端首次初始化保险箱的动作）
      await backend.testAsync();
      // 探针也由桌面端实现生成：验证移动端能通过桌面端创建的保险箱口令校验
      const verifier = desktopCrypto!.encrypt('SN1:' + 'STICKYNOTES_AUTH_OK', secret);
      await backend.putTextAsync(
        '.auth_verifier',
        JSON.stringify({ version: 1, iv: verifier.iv, payload: verifier.data }),
      );
      await backend.putTextAsync(noteKey(id), JSON.stringify(dto));
      backend.dispose();

      const repo = new InMemoryRepo();
      const summary = await new SyncEngine(repo).runAsync(makeBackend(true), DEVICE_MOBILE, {
        enableEncryption: true,
        secret,
      });

      expect(summary!.skippedInvalid).toBe(0);
      expect(repo.notes.get(id)!.content).toBe(content);
    });

    maybe('移动端加密的便签可被桌面端解密（同一专属密钥）', async () => {
      const id = 'e1e1e1e1-5555-6666-7777-888899990000';
      const content = '移动端写入的机密内容 📱';

      const repo = new InMemoryRepo();
      repo.notes.set(id, makeNote({ id, content }));
      await new SyncEngine(repo).runAsync(makeBackend(true), DEVICE_MOBILE, {
        enableEncryption: true,
        secret,
      });

      const remote = readJson(path.join(vaultDir(), `${id}.json`));
      const plain = desktopCrypto!.decrypt(remote['iv'] as string, remote['payload'] as string, secret);
      expect(plain).toBe('SN1:' + content);
      expect(plain.slice('SN1:'.length)).toBe(content);
    });
  });

  test('明文与密文两套数据集互不可见', async () => {
    const id = 'f1f1f1f1-6666-7777-8888-999900001111';
    const plainRepo = new InMemoryRepo();
    plainRepo.notes.set(id, makeNote({ id, content: 'data-mode' }));
    await new SyncEngine(plainRepo).runAsync(makeBackend(false), DEVICE_MOBILE);

    // 切到加密模式：本地库同一条便签会以密文形式重新上传到 vault 目录
    const vaultRepo = new InMemoryRepo();
    vaultRepo.notes.set(id, makeNote({ id, content: 'vault-mode' }));
    await new SyncEngine(vaultRepo).runAsync(makeBackend(true), DEVICE_MOBILE, {
      enableEncryption: true,
      secret,
    });

    // 两套目录各自独立，明文目录内容未被密文写入影响
    expect(readJson(path.join(dataDir(), `${id}.json`))['content']).toBe('data-mode');
    const vaultRemote = readJson(path.join(vaultDir(), `${id}.json`));
    expect('content' in vaultRemote).toBe(false);
    expect(unwrapMagicPayload(vaultRemote['iv'] as string, vaultRemote['payload'] as string, secret)).toBe(
      'vault-mode',
    );

    // 明文模式再跑一轮：只看得到 data 目录，不受 vault 影响
    const rereadRepo = new InMemoryRepo();
    const legacy = serializeDto(dtoFromNote(makeNote({ id, content: 'data-mode' }), DEVICE_DESKTOP));
    expect(legacy).toContain('data-mode');
    const summary = await new SyncEngine(rereadRepo).runAsync(makeBackend(false), DEVICE_DESKTOP);
    expect(summary!.downloaded).toBe(1);
    expect(rereadRepo.notes.get(id)!.content).toBe('data-mode');
  });
});
