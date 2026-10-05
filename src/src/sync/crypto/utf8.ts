// 自给自足的 UTF-8 编解码（不依赖 TextEncoder / TextDecoder，避免 RN Hermes 与 Node 环境差异）。
// 编码侧对齐 C# Encoding.UTF8.GetBytes：孤立代理（lone surrogate）替换为 U+FFFD。
// 解码侧对齐 C# Encoding.UTF8.GetString 语义，但遇非法字节序列直接抛错——
// 解密后若出现非法 UTF-8，说明密钥不匹配或密文损坏，必须早暴露（绝不静默写成乱码入库）。

const REPLACEMENT = [0xef, 0xbf, 0xbd];

/** 字符串 → UTF-8 字节 */
export function utf8Encode(input: string): Uint8Array {
  const buf = new Uint8Array(input.length * 3);
  let o = 0;

  for (let i = 0; i < input.length; i++) {
    let cp = input.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      const next = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        buf[o++] = REPLACEMENT[0];
        buf[o++] = REPLACEMENT[1];
        buf[o++] = REPLACEMENT[2];
        continue;
      }
    } else if (cp >= 0xdc00 && cp <= 0xdfff) {
      buf[o++] = REPLACEMENT[0];
      buf[o++] = REPLACEMENT[1];
      buf[o++] = REPLACEMENT[2];
      continue;
    }

    if (cp < 0x80) {
      buf[o++] = cp;
    } else if (cp < 0x800) {
      buf[o++] = 0xc0 | (cp >> 6);
      buf[o++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      buf[o++] = 0xe0 | (cp >> 12);
      buf[o++] = 0x80 | ((cp >> 6) & 0x3f);
      buf[o++] = 0x80 | (cp & 0x3f);
    } else {
      buf[o++] = 0xf0 | (cp >> 18);
      buf[o++] = 0x80 | ((cp >> 12) & 0x3f);
      buf[o++] = 0x80 | ((cp >> 6) & 0x3f);
      buf[o++] = 0x80 | (cp & 0x3f);
    }
  }

  return buf.slice(0, o);
}

/** UTF-8 字节 → 字符串；非法序列抛错 */
export function utf8Decode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: number[] = [];

  const flush = (): void => {
    if (chunk.length > 0) {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    }
  };

  const len = bytes.length;
  let i = 0;
  while (i < len) {
    const b0 = bytes[i++];
    let cp: number;

    if (b0 < 0x80) {
      cp = b0;
    } else if ((b0 & 0xe0) === 0xc0) {
      if (i >= len) throw new Error('非法 UTF-8：截断的 2 字节序列');
      const b1 = bytes[i++];
      if ((b1 & 0xc0) !== 0x80) throw new Error('非法 UTF-8：续字节格式错误');
      cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
      if (cp < 0x80) throw new Error('非法 UTF-8：过长编码');
    } else if ((b0 & 0xf0) === 0xe0) {
      if (i + 1 >= len) throw new Error('非法 UTF-8：截断的 3 字节序列');
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) throw new Error('非法 UTF-8：续字节格式错误');
      cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      if (cp < 0x800) throw new Error('非法 UTF-8：过长编码');
    } else if ((b0 & 0xf8) === 0xf0) {
      if (i + 2 >= len) throw new Error('非法 UTF-8：截断的 4 字节序列');
      const b1 = bytes[i++];
      const b2 = bytes[i++];
      const b3 = bytes[i++];
      if ((b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) {
        throw new Error('非法 UTF-8：续字节格式错误');
      }
      cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      if (cp < 0x10000 || cp > 0x10ffff) throw new Error('非法 UTF-8：码点越界');
    } else {
      throw new Error('非法 UTF-8：首字节非法');
    }

    if (cp <= 0xffff) {
      chunk.push(cp);
    } else {
      const v = cp - 0x10000;
      chunk.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
    if (chunk.length >= 4096) flush();
  }
  flush();
  return parts.join('');
}
