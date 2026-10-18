import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyFirebaseToken, withApiAuth } from '../src/lib/server/auth.ts';
import { publicUrl, isPublicAddress, safeFetch } from '../src/lib/server/network.ts';
import { readBody, readJson, validateSiteConfig, assertSiteUrl } from '../src/lib/server/request.ts';

test('API rejects requests without a Firebase token before running the handler', async () => {
  let called = false;
  const result = await withApiAuth(new Request('https://app.example/api/wp/post'), async () => { called = true; return new Response(); });
  assert.equal(result.status, 401);
  assert.equal(called, false);
});

test('Firebase signature, project, expiry, and required claims are verified', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test', alg: 'RS256' }] });
  const now = Math.floor(Date.now() / 1000);
  const sign = (claims: Record<string, unknown> = {}) => new SignJWT({ sub: 'user-a', aud: 'demo', iss: 'https://securetoken.google.com/demo', exp: now + 60, iat: now, auth_time: now, ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(privateKey);
  assert.equal(await verifyFirebaseToken(await sign(), 'demo', keys), 'user-a');
  await assert.rejects(verifyFirebaseToken(await sign(), 'another-project', keys));
  await assert.rejects(verifyFirebaseToken(await sign({ exp: now - 1 }), 'demo', keys));
  await assert.rejects(verifyFirebaseToken(await sign({ auth_time: undefined }), 'demo', keys));
  await assert.rejects(verifyFirebaseToken(await sign({ auth_time: now + 60 }), 'demo', keys));
  await assert.rejects(verifyFirebaseToken(await sign({ sub: '' }), 'demo', keys));
});

test('SSRF guard blocks local, private, metadata, mapped IPs and non-web protocols', () => {
  for (const url of ['http://127.0.0.1', 'http://2130706433', 'http://10.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://localhost', 'file:///etc/passwd', 'http://example.com:3000', 'https://user:pass@example.com']) assert.throws(() => publicUrl(url), url);
  for (const ip of ['172.16.0.1', '192.168.0.1', '0.0.0.0', '100.64.0.1', 'fc00::1', 'fe80::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(publicUrl('https://example.com/blog').hostname, 'example.com');
  assert.equal(isPublicAddress('8.8.8.8'), true);
});

test('authenticated redirects cannot leak credentials to another origin', async t => {
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL) => { calls.push(url.href); return new Response(null, { status: 302, headers: { location: 'https://other.example/path' } }); });
  await assert.rejects(safeFetch('https://example.com', { headers: { Authorization: 'Basic test' } }), /website khác/);
  assert.equal(calls.length, 1);
});

test('response size guard rejects oversized downloads', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x', { headers: { 'content-length': String(21 * 1024 * 1024) } }));
  await assert.rejects(safeFetch('https://example.com'), /20 MB/);
});

test('request size limit works without a content-length header', async () => {
  await assert.rejects(readBody(new Request('https://app.example', { method: 'POST', body: '123456' }), 5), /quá lớn/);
  assert.equal(new TextDecoder().decode(await readBody(new Request('https://app.example', { method: 'POST', body: '12345' }), 5)), '12345');
});

test('untrusted auth headers are discarded and cross-site post URLs rejected', async () => {
  const config = validateSiteConfig({ wp_url: 'example.com', wp_user: 'u', wp_app_pass: 'p', authHeaders: { Cookie: 'injected' } });
  assert.equal(config.wp_url, 'https://example.com');
  assert.equal(config.authHeaders, undefined);
  assert.throws(() => assertSiteUrl('https://other.example/post', config.wp_url));
  assert.doesNotThrow(() => assertSiteUrl('https://example.com/post', config.wp_url));
  await assert.rejects(readJson(new Request('https://app.example', { method: 'POST', body: '{broken' })), /JSON/);
});
