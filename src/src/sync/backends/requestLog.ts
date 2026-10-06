// 网络请求级日志共享小工具（WebDAV 与 S3 后端共用）。
// 隐私红线：不记录 Authorization/凭据与查询串，不记录请求体内容（仅字节数）；
// 错误响应体是服务器返回的提示（如 413 配额说明），截断记录用于定位问题。

/** 去掉 query 串后的请求 URL（S3 列表参数、签名均不在 URL 明文里，无需保留） */
export function stripQuery(url: string): string {
  const i = url.indexOf('?');
  return i >= 0 ? url.slice(0, i) : url;
}

/** 读取响应体片段（clone 后读取，不影响调用方随后消费原始响应）；压平空白并截断 */
export async function readBodySnippetAsync(res: Response, max = 300): Promise<string> {
  try {
    const text = (await res.clone().text()).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + '...<truncated>' : text;
  } catch {
    return '';
  }
}
