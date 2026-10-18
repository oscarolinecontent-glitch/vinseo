import 'server-only';
import { publicUrl } from './network.ts';
import type { SiteConfig } from '../types.ts';

export class InputError extends Error { status = 400; }

export function errorStatus(error: unknown): number { return error instanceof InputError ? error.status : 500; }

export async function readBody(req: Request, limit = 512 * 1024): Promise<Uint8Array> {
  if (Number(req.headers.get('content-length')) > limit) throw new InputError('Dữ liệu gửi lên quá lớn.');
  const reader = req.body?.getReader();
  if (!reader) throw new InputError('Request không có dữ liệu.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new InputError('Dữ liệu gửi lên quá lớn.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export function validateSiteConfig(value: unknown): SiteConfig {
  if (!value || typeof value !== 'object') throw new InputError('Thiếu cấu hình WordPress.');
  const data = value as Record<string, unknown>;
  for (const field of ['wp_url', 'wp_user', 'wp_app_pass']) {
    if (typeof data[field] !== 'string' || !data[field] || data[field].length > 2048) throw new InputError(`Cấu hình ${field} không hợp lệ.`);
  }
  for (const field of ['wp_password', 'wp_login_path', 'image_format']) {
    if (data[field] !== undefined && (typeof data[field] !== 'string' || data[field].length > 2048)) throw new InputError(`Cấu hình ${field} không hợp lệ.`);
  }
  const url = (data.wp_url as string).trim();
  try { data.wp_url = publicUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`).href.replace(/\/$/, ''); }
  catch { throw new InputError('URL WordPress không hợp lệ hoặc là địa chỉ nội bộ.'); }
  // Only the server may establish cookie/nonce credentials.
  delete data.authHeaders;
  return data as unknown as SiteConfig;
}

export function assertSiteUrl(target: string, site: string): void {
  try {
    const url = new URL(target);
    if (url.origin !== new URL(site).origin) throw new Error('different origin');
  } catch { throw new InputError('URL bài viết phải thuộc đúng website đã chọn.'); }
}

export async function readJson(req: Request) {
  let data;
  try { data = JSON.parse(new TextDecoder().decode(await readBody(req))); }
  catch (error) { if (error instanceof InputError) throw error; throw new InputError('JSON không hợp lệ.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new InputError('Dữ liệu không hợp lệ.');
  data.siteConfig = validateSiteConfig(data.siteConfig);
  if (data.postData?.wp_post_url) assertSiteUrl(data.postData.wp_post_url, data.siteConfig.wp_url);
  if (Array.isArray(data.postUrls)) for (const url of data.postUrls) assertSiteUrl(url, data.siteConfig.wp_url);
  return data;
}
