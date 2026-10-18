import 'server-only';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';
import { requestContext } from './context.ts';

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

export function publicUrl(input: string | URL): URL {
  const url = new URL(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) {
    throw new Error('URL phải dùng HTTP/HTTPS và cổng tiêu chuẩn.');
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || (isIP(hostname) && !isPublicAddress(hostname))) {
    throw new Error('Không được truy cập địa chỉ mạng nội bộ.');
  }
  return url;
}

// Validate DNS at socket connection time. A separate preflight lookup would
// leave a DNS-rebinding gap between validation and the actual connection.
const safeLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true, verbatim: false }).then(addresses => {
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      callback(new Error('DNS trỏ đến địa chỉ mạng nội bộ.'), '', 4);
      return;
    }
    const eligible = options.family ? addresses.filter(a => a.family === options.family) : addresses;
    if (!eligible.length) { callback(new Error('Không tìm thấy địa chỉ IP phù hợp.'), '', 4); return; }
    if (options.all) callback(null, eligible);
    else callback(null, eligible[0].address, eligible[0].family);
  }).catch(error => callback(error, '', 4));
};

const dispatcher = new Agent({ connect: { lookup: safeLookup, timeout: 10_000 }, connections: 6 });

/** Bounded, timed requests with DNS pinning and checked redirects. */
export async function safeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  let url = publicUrl(input);
  const headers = new Headers(init.headers);
  const sensitive = headers.has('authorization') || headers.has('cookie') || headers.has('x-wp-nonce') || !!init.body;
  const timeout = AbortSignal.timeout(45_000);
  const signals = [timeout, init.signal, requestContext.getStore()?.signal].filter((s): s is AbortSignal => !!s);
  const signal = AbortSignal.any(signals);
  let method = init.method || 'GET';
  let body = init.body;
  for (let redirects = 0; redirects <= 5; redirects++) {
    const options: RequestInit & { dispatcher: Agent } = { ...init, method, body, headers, signal, dispatcher, redirect: 'manual', cache: 'no-store' };
    const response = await fetch(url, options);
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location && init.redirect !== 'manual') {
      await response.body?.cancel();
      if (init.redirect === 'error' || redirects === 5) throw new Error('Quá nhiều chuyển hướng.');
      const target = publicUrl(new URL(location, url));
      if (sensitive && target.origin !== url.origin) throw new Error('Không gửi thông tin đăng nhập sang website khác.');
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
        method = 'GET'; body = undefined; headers.delete('content-type'); headers.delete('content-length');
      }
      url = target;
      continue;
    }
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel(); throw new Error('Dữ liệu tải về vượt giới hạn 20 MB.');
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) throw new Error('Dữ liệu tải về vượt giới hạn 20 MB.');
          chunks.push(value);
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error; }
      finally { reader.releaseLock(); }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const resultHeaders = new Headers(response.headers);
    resultHeaders.delete('content-encoding'); resultHeaders.delete('content-length');
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, statusText: response.statusText, headers: resultHeaders });
  }
  throw new Error('Không thể hoàn thành request.');
}
