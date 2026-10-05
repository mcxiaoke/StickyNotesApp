// 加密纯函数单测：以桌面端 scripts/crypto_compat/vectors.json 为唯一真相源，
// 验证移动端实现与 C# / Node.js / Kotlin / Dart / Python 五语言基准逐字节一致。
// fixtures/crypto-vectors.json 为桌面端向量的只读副本（源自
// StickyNotesDesktop/scripts/crypto_compat/vectors.json，复制于 2026-10-05）。

import { cbc } from '@noble/ciphers/aes.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

import {
  MAGIC_HEADER,
  SyncCryptoError,
  createMagicPayload,
  decrypt,
  deriveKey,
  encrypt,
  unwrapMagicPayload,
} from '../src/sync/crypto/cryptoHelper';
import { base64ToBytes, bytesToBase64 } from '../src/sync/crypto/base64';
import { utf8Decode, utf8Encode } from '../src/sync/crypto/utf8';
import { PUBLIC_FALLBACK_SECRET, getVaultSecret, isUsingLocalSecret } from '../src/sync/crypto/vaultSecret';

interface NistKat {
  name: string;
  key_hex: string;
  iv_hex: string;
  plaintext_hex: string;
  ciphertext_hex: string;
}

interface AppCase {
  id: string;
  description: string;
  password: string;
  iv_base64: string;
  plaintext: string;
  expected_ciphertext_base64: string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const vectors = require('./fixtures/crypto-vectors.json') as {
  nist_kat: NistKat[];
  app_scheme: { cases: AppCase[] };
};

describe('AES-256-CBC 跨平台基准（NIST KAT，无填充原始模式）', () => {
  test('全部 NIST KAT 向量逐字节一致', () => {
    expect(vectors.nist_kat.length).toBeGreaterThan(0);
    for (const item of vectors.nist_kat) {
      const key = hexToBytes(item.key_hex);
      const iv = hexToBytes(item.iv_hex);
      const pt = hexToBytes(item.plaintext_hex);

      const ct = cbc(key, iv, { disablePadding: true }).encrypt(pt);
      expect(`${item.name}: ${bytesToHex(ct)}`).toBe(`${item.name}: ${item.ciphertext_hex.toLowerCase()}`);

      const back = cbc(key, iv, { disablePadding: true }).decrypt(ct);
      expect(bytesToHex(back)).toBe(item.plaintext_hex.toLowerCase());
    }
  });
});

describe('应用方案基准（Key=SHA256(口令), PKCS7, 固定 IV）', () => {
  for (const c of vectors.app_scheme.cases) {
    test(`${c.id} - ${c.description}`, () => {
      const fixedIv = base64ToBytes(c.iv_base64);
      const result = encrypt(c.plaintext, c.password, fixedIv);

      expect(result.iv).toBe(c.iv_base64);
      expect(result.payload).toBe(c.expected_ciphertext_base64);
      expect(decrypt(c.iv_base64, c.expected_ciphertext_base64, c.password)).toBe(c.plaintext);
    });
  }
});

describe('魔数守卫（SN1:）', () => {
  test('创建与解包往返（含中文与 Emoji）', () => {
    const content = '便签正文 📝🚀\n第二行\r\n\tTab';
    const { iv, payload } = createMagicPayload(content, 'unit-test-secret');
    expect(unwrapMagicPayload(iv, payload, 'unit-test-secret')).toBe(content);
  });

  test('空正文往返（PKCS7 单块填充）', () => {
    const { iv, payload } = createMagicPayload('', 'unit-test-secret');
    expect(unwrapMagicPayload(iv, payload, 'unit-test-secret')).toBe('');
  });

  test('口令不匹配时抛 SyncCryptoError（绝不返回乱码）', () => {
    const { iv, payload } = createMagicPayload('secret content', 'right-secret');
    expect(() => unwrapMagicPayload(iv, payload, 'wrong-secret')).toThrow(SyncCryptoError);
  });

  test('缺少魔数前缀的合法密文被拦截（伪解密防护）', () => {
    const { iv, payload } = encrypt('no-magic-here', 'unit-test-secret');
    expect(() => unwrapMagicPayload(iv, payload, 'unit-test-secret')).toThrow(/魔数/);
  });

  test('魔数常量与桌面端一致', () => {
    expect(MAGIC_HEADER).toBe('SN1:');
  });
});

describe('密钥提供器', () => {
  test('本地专属密钥已配置且不是公开回落口令', () => {
    const secret = getVaultSecret();
    expect(secret.length).toBe(64);
    expect(secret).not.toBe(PUBLIC_FALLBACK_SECRET);
    expect(isUsingLocalSecret()).toBe(true);
  });

  test('同一口令派生出稳定的 32 字节密钥', () => {
    const key = deriveKey(getVaultSecret());
    expect(key.length).toBe(32);
    expect(bytesToHex(key)).toBe(bytesToHex(deriveKey(getVaultSecret())));
  });
});

describe('Base64 编解码', () => {
  test('对齐 C# Convert 语义（含 RFC4648 官方向量）', () => {
    expect(bytesToBase64(utf8Encode(''))).toBe('');
    expect(bytesToBase64(utf8Encode('f'))).toBe('Zg==');
    expect(bytesToBase64(utf8Encode('fo'))).toBe('Zm8=');
    expect(bytesToBase64(utf8Encode('foo'))).toBe('Zm9v');
    expect(bytesToBase64(utf8Encode('foob'))).toBe('Zm9vYg==');
    expect(bytesToBase64(utf8Encode('fooba'))).toBe('Zm9vYmE=');
    expect(bytesToBase64(utf8Encode('foobar'))).toBe('Zm9vYmFy');
  });

  test('全字节值（0x00-0xFF）往返无损', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  test('空白字符被忽略，非法字符抛错', () => {
    expect([...base64ToBytes('Zm9v\nYmFy')]).toEqual([...utf8Encode('foobar')]);
    expect(() => base64ToBytes('Zm9vYmF')).toThrow();
    expect(() => base64ToBytes('Zm9v$mFy')).toThrow();
  });
});

describe('UTF-8 编解码', () => {
  test('往返覆盖 ASCII / 中文 / Emoji / 代理对 / 空串', () => {
    const samples = ['', 'ascii', '中文测试', '📝🚀🎉', 'a中b📝c', '\u0000\u007f\u0080\u07ff\u0800\uffff'];
    for (const s of samples) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });

  test('与标准 UTF-8 字节序列一致', () => {
    expect(bytesToHex(utf8Encode('中'))).toBe('e4b8ad');
    expect(bytesToHex(utf8Encode('📝'))).toBe('f09f939d');
  });

  test('孤立代理替换为 U+FFFD（对齐 C# Encoding.UTF8）', () => {
    expect(bytesToHex(utf8Encode('\ud800'))).toBe('efbfbd');
  });

  test('非法字节序列抛错', () => {
    expect(() => utf8Decode(new Uint8Array([0xff]))).toThrow();
    expect(() => utf8Decode(new Uint8Array([0xe4, 0xb8]))).toThrow();
  });
});
