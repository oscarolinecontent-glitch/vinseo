import 'server-only';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { requestContext } from './context.ts';

const firebaseKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'), { timeoutDuration: 10_000 });

export async function verifyFirebaseToken(token: string, projectId: string, keys: JWTVerifyGetKey = firebaseKeys): Promise<string> {
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['RS256'],
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    requiredClaims: ['exp', 'iat', 'sub', 'auth_time'],
  });
  const now = Math.floor(Date.now() / 1000);
  if (!payload.sub || payload.sub.length > 128 || typeof payload.iat !== 'number' || payload.iat > now || typeof payload.auth_time !== 'number' || payload.auth_time > now) {
    throw new Error('Invalid Firebase claims');
  }
  return payload.sub;
}

/** Authentication is enforced in each route, not in the dashboard layout. */
export async function withApiAuth(req: Request, handler: () => Promise<Response>): Promise<Response> {
  const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return Response.json({ success: false, message: 'Vui lòng đăng nhập.' }, { status: 401 });
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) return Response.json({ success: false, message: 'Chưa cấu hình Firebase.' }, { status: 503 });
  let uid: string;
  try {
    uid = await verifyFirebaseToken(token, projectId);
  } catch {
    return Response.json({ success: false, message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' }, { status: 401 });
  }
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(270_000)]);
  return requestContext.run({ uid, signal }, handler);
}
