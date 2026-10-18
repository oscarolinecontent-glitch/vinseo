import { auth } from './firebase';

/** Send the current Firebase identity to our API, including multipart uploads. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/api/')) throw new Error('API path không hợp lệ.');
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  const timeout = AbortSignal.timeout(280_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(path, { ...init, headers, signal });
}
