// 纯 TS Base64 编解码（不依赖 btoa / atob / Buffer，避免 RN Hermes 环境差异）。
// 与 C# Convert.ToBase64String / Convert.FromBase64String 行为一致：标准字母表、带 '=' 补齐、
// 解码时忽略空白字符，遇非法字符抛错。

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 字节 → 标准 Base64 字符串 */
export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  const parts: string[] = [];
  const quad: string[] = [];

  const flush = (): void => {
    if (quad.length > 0) {
      parts.push(quad.join(''));
      quad.length = 0;
    }
  };

  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    quad.push(CHARS[(n >>> 18) & 63], CHARS[(n >>> 12) & 63], CHARS[(n >>> 6) & 63], CHARS[n & 63]);
    if (quad.length >= 4096) flush();
  }

  const rest = len - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    quad.push(CHARS[(n >>> 18) & 63], CHARS[(n >>> 12) & 63], '=', '=');
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    quad.push(CHARS[(n >>> 18) & 63], CHARS[(n >>> 12) & 63], CHARS[(n >>> 6) & 63], '=');
  }
  flush();
  return parts.join('');
}

let reverseTable: Int16Array | null = null;

function reverseOf(code: number): number {
  if (code === 61) return 0; // '='
  if (code < 0 || code > 127) return -1;
  if (!reverseTable) {
    const table = new Int16Array(128).fill(-1);
    for (let i = 0; i < CHARS.length; i++) table[CHARS.charCodeAt(i)] = i;
    reverseTable = table;
  }
  return reverseTable[code];
}

/** 标准 Base64 字符串 → 字节；非法字符或长度异常抛错（对齐 C# 行为语义） */
export function base64ToBytes(input: string): Uint8Array {
  const s = input.replace(/[\r\n\t ]/g, '');
  if (s.length % 4 !== 0) throw new Error('Base64 长度非法（非 4 的倍数）');

  let pad = 0;
  if (s.endsWith('==')) pad = 2;
  else if (s.endsWith('=')) pad = 1;

  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const c0 = reverseOf(s.charCodeAt(i));
    const c1 = reverseOf(s.charCodeAt(i + 1));
    const c2 = reverseOf(s.charCodeAt(i + 2));
    const c3 = reverseOf(s.charCodeAt(i + 3));
    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) throw new Error('Base64 含非法字符');

    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < out.length) out[o++] = (n >>> 16) & 0xff;
    if (o < out.length) out[o++] = (n >>> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}
