import type { SiteConfig } from '@/lib/types';
import { safeFetch as fetch } from './server/network';
// Lưu cache session trong bộ nhớ của server để tránh spam wp-login.php liên tục gây lỗi 1006
import { createHash } from 'node:crypto';
import { requestContext } from './server/context';
const sessionCache = new Map<string, { cookieStr: string; nonce: string; timestamp: number }>();
const SESSION_TTL = 30 * 60 * 1000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Suy ra đường dẫn wp-admin base từ login path.
 * Hỗ trợ WordPress cài trong thư mục con (VD: /wp/) mà site URL là root.
 * 
 * Ví dụ:
 *   /wp/wp-login.php   → /wp/wp-admin
 *   /wp-login.php      → /wp-admin
 *   /custom-login      → /wp-admin  (custom path → dùng mặc định)
 */
export function getWpAdminPath(loginPath: string): string {
  // Nếu là full URL (https://...), chỉ lấy pathname để tính admin path
  let pathOnly = loginPath;
  try {
    if (loginPath.startsWith('http')) {
      pathOnly = new URL(loginPath).pathname;
    }
  } catch { }

  const idx = pathOnly.lastIndexOf('wp-login.php');
  if (idx > 0) {
    // pathOnly = /wp/wp-login.php → prefix = /wp/ → return /wp/wp-admin
    const prefix = pathOnly.substring(0, idx);
    return `${prefix}wp-admin`;
  }
  // Mặc định
  return '/wp-admin';
}


/**
 * Giả lập browser: GET trang login → lấy form action + hidden fields + cookies → POST form login.
 * Xử lý chính xác các trường hợp:
 * - Login URL custom (VD: /web_auth/, /hidden-login/)
 * - Plugin WPS Hide Login, iThemes Security...
 * - HTTP Basic Auth gateway (user:pass@domain)
 */
async function attemptWpLogin(
  loginPageUrl: string,
  wpUser: string,
  wpPassword: string,
  basicAuthHeader: string,
  base: string,
  adminBase: string
): Promise<{ cookieStr: string; nonce: string } | null> {
  try {
    // ===================== BƯỚC 1: GET TRANG LOGIN =====================
    // Giả lập browser truy cập trang login để lấy cookies + form action + hidden fields
    const getHeaders: Record<string, string> = {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Connection': 'close',
    };
    if (basicAuthHeader) {
      getHeaders['Authorization'] = basicAuthHeader;
    }

    const getRes = await fetch(loginPageUrl, {
      method: 'GET',
      headers: getHeaders,
      redirect: 'follow', // Theo redirect để đến trang login thật
    });

    const loginHtml = await getRes.text();

    // Thu thập cookies từ GET response (test_cookie, etc.)
    let getCookies: string[] = [];
    const getRawCookies = getRes.headers.getSetCookie?.() ?? [];
    if (getRawCookies.length > 0) {
      getCookies = getRawCookies.map((c: string) => c.split(';')[0]);
    } else {
      const sc = getRes.headers.get('set-cookie');
      if (sc) getCookies = [sc.split(';')[0]];
    }

    // ===================== BƯỚC 2: PHÂN TÍCH FORM LOGIN =====================
    // Tìm form action URL
    const formActionMatch = loginHtml.match(/<form[^>]*name=["']loginform["'][^>]*action=["']([^"']+)["']/i)
      || loginHtml.match(/<form[^>]*id=["']loginform["'][^>]*action=["']([^"']+)["']/i);
    
    // Nếu tìm thấy form action, dùng nó; nếu không thì dùng URL hiện tại
    let formActionUrl = loginPageUrl;
    if (formActionMatch && formActionMatch[1]) {
      const rawAction = formActionMatch[1].replace(/&amp;/g, '&');
      if (rawAction.startsWith('http')) {
        formActionUrl = rawAction;
      } else if (rawAction.startsWith('/')) {
        formActionUrl = `${base}${rawAction}`;
      } else {
        formActionUrl = `${loginPageUrl.replace(/[^/]*$/, '')}${rawAction}`;
      }
    }

    if (new URL(formActionUrl).origin !== new URL(base).origin) {
      throw new Error('Form đăng nhập chuyển sang website khác.');
    }

    // Tìm tất cả hidden fields trong form (nonce, security tokens...)
    const hiddenFields: Record<string, string> = {};
    const hiddenRegex = /<input[^>]*type=["']hidden["'][^>]*>/gi;
    let match;
    while ((match = hiddenRegex.exec(loginHtml)) !== null) {
      const fieldHtml = match[0];
      const nameMatch = fieldHtml.match(/name=["']([^"']+)["']/);
      const valueMatch = fieldHtml.match(/value=["']([^"']*?)["']/);
      if (nameMatch) {
        hiddenFields[nameMatch[1]] = valueMatch ? valueMatch[1] : '';
      }
    }


    // ===================== BƯỚC 3: POST FORM LOGIN =====================
    const loginForm = new URLSearchParams({
      ...hiddenFields,
      log: wpUser,
      pwd: wpPassword,
      'wp-submit': 'Log In',
      redirect_to: `${base}${adminBase}/`,
      testcookie: '1',
    });

    // Gộp cookies từ GET response + test cookie
    const postCookies = [...getCookies, 'wordpress_test_cookie=WP+Cookie+check'];
    const cookieHeader = postCookies.join('; ');

    const postHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader,
      'User-Agent': UA,
      'Connection': 'close',
      'Referer': loginPageUrl,
      'Origin': base,
    };
    if (basicAuthHeader) {
      postHeaders['Authorization'] = basicAuthHeader;
    }

    const loginRes = await fetch(formActionUrl, {
      method: 'POST',
      headers: postHeaders,
      body: loginForm.toString(),
      redirect: 'manual',
    });

    // Thu thập cookies từ POST response
    const allCookieParts: string[] = [...getCookies]; // Giữ lại cookies từ GET
    const postRawCookies = loginRes.headers.getSetCookie?.() ?? [];
    if (postRawCookies.length > 0) {
      allCookieParts.push(...postRawCookies.map((c: string) => c.split(';')[0]));
    } else {
      const sc = loginRes.headers.get('set-cookie');
      if (sc) allCookieParts.push(sc.split(';')[0]);
    }

    // Deduplicate cookies (ưu tiên cookie mới nhất nếu trùng tên)
    const cookieMap: Record<string, string> = {};
    for (const part of allCookieParts) {
      const [nameVal] = part.split(';');
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx > 0) {
        cookieMap[nameVal.substring(0, eqIdx)] = nameVal;
      }
    }
    const finalCookieStr = Object.values(cookieMap).join('; ');

    if (!finalCookieStr.includes('wordpress_logged_in')) {
      const location = loginRes.headers.get('location') || '';
      console.warn(`wpAuth: Login failed (Status: ${loginRes.status}), no wordpress_logged_in cookie.`);
      
      // Nếu có redirect, thử follow nó để lấy cookies (một số WP config redirect qua nhiều bước)
      if (location && loginRes.status >= 300 && loginRes.status < 400) {
        const redirectUrl = location.startsWith('http') ? location : `${base}${location}`;
        if (new URL(redirectUrl).origin !== new URL(base).origin) return null;
        const redirectRes = await fetch(redirectUrl, {
          method: 'GET',
          headers: {
            'Cookie': finalCookieStr,
            'User-Agent': UA,
            'Connection': 'close',
            ...(basicAuthHeader ? { 'Authorization': basicAuthHeader } : {}),
          },
          redirect: 'manual',
        });
        
        const redirectCookies = redirectRes.headers.getSetCookie?.() ?? [];
        if (redirectCookies.length > 0) {
          for (const c of redirectCookies) {
            const [nameVal] = c.split(';');
            const eqIdx = nameVal.indexOf('=');
            if (eqIdx > 0) {
              cookieMap[nameVal.substring(0, eqIdx)] = nameVal;
            }
          }
        }
        
        const updatedCookieStr = Object.values(cookieMap).join('; ');
        if (updatedCookieStr.includes('wordpress_logged_in')) {
          return await fetchNonce(updatedCookieStr, basicAuthHeader, base, adminBase);
        }
      }
      
      return null;
    }

    return await fetchNonce(finalCookieStr, basicAuthHeader, base, adminBase);
  } catch (e) {
    console.error('wpAuth attemptWpLogin error:', e);
    return null;
  }
}

/**
 * Lấy WP REST API nonce từ trang wp-admin (cần session cookie đã login)
 */
async function fetchNonce(
  cookieStr: string,
  basicAuthHeader: string,
  base: string,
  adminBase: string
): Promise<{ cookieStr: string; nonce: string } | null> {
  const editHeaders: Record<string, string> = {
    'Cookie': cookieStr,
    'User-Agent': UA,
    'Connection': 'close',
  };
  if (basicAuthHeader) {
    editHeaders['Authorization'] = basicAuthHeader;
  }

  const editPageRes = await fetch(`${base}${adminBase}/post-new.php`, {
    headers: editHeaders,
  });
  const editPageHtml = await editPageRes.text();

  // Thử nhiều patterns khác nhau (Gutenberg, Classic Editor, inline JSON, etc.)
  const nonceMatch = editPageHtml.match(/wpApiSettings[\s\S]*?"nonce":"([a-f0-9]+)"/i)
    || editPageHtml.match(/"restNonce":"([a-f0-9]+)"/i)
    || editPageHtml.match(/rankMath[\s\S]*?"nonce":"([a-f0-9]+)"/i)
    || editPageHtml.match(/"wp_rest":"([a-f0-9]+)"/i)
    || editPageHtml.match(/wp\.apiFetch\.use\(.*?nonce['":\s]+([a-f0-9]+)/i)
    || editPageHtml.match(/"nonce":"([a-f0-9]+)"/i);

  if (nonceMatch) {
    return { cookieStr, nonce: nonceMatch[1] };
  }

  // Fallback: thử lấy nonce qua admin-ajax
  try {
    const ajaxNonceRes = await fetch(`${base}${adminBase}/admin-ajax.php?action=rest-nonce`, {
      headers: { 'Cookie': cookieStr, 'User-Agent': UA, 'Connection': 'close', ...(basicAuthHeader ? { 'Authorization': basicAuthHeader } : {}) },
    });
    const ajaxText = await ajaxNonceRes.text();
    if (ajaxNonceRes.ok && /^[a-f0-9]{10}$/i.test(ajaxText.trim())) {
      return { cookieStr, nonce: ajaxText.trim() };
    }
  } catch { }

  // Fallback 2: thử /wp-admin/profile.php
  try {
    const profileRes = await fetch(`${base}${adminBase}/profile.php`, {
      headers: { 'Cookie': cookieStr, 'User-Agent': UA, 'Connection': 'close', ...(basicAuthHeader ? { 'Authorization': basicAuthHeader } : {}) },
    });
    const profileHtml = await profileRes.text();
    const profileNonce = profileHtml.match(/wpApiSettings[\s\S]*?"nonce":"([a-f0-9]+)"/i)
      || profileHtml.match(/"restNonce":"([a-f0-9]+)"/i)
      || profileHtml.match(/"nonce":"([a-f0-9]+)"/i);
    if (profileNonce) {
      return { cookieStr, nonce: profileNonce[1] };
    }
  } catch { }

  console.error('wpAuth: Nonce not found anywhere.');
  return null;
}

export async function getWpAdminSession(siteConfig: SiteConfig): Promise<{ cookieStr: string, nonce: string } | null> {
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const loginPass = siteConfig.wp_password || siteConfig.wp_app_pass;

  if (!loginPass || !siteConfig.wp_user) {
    console.warn('wpAuth: Missing wp_user or password.');
    return null;
  }

  const uid = requestContext.getStore()?.uid;
  if (!uid) throw new Error('Thiếu phiên đăng nhập ứng dụng.');
  const cacheKey = createHash('sha256').update(JSON.stringify([uid, base, siteConfig.wp_user, loginPass, siteConfig.wp_app_pass, siteConfig.wp_login_path])).digest('hex');
  const now = Date.now();
  for (const [key, value] of sessionCache) if (now - value.timestamp >= SESSION_TTL) sessionCache.delete(key);
  const cached = sessionCache.get(cacheKey);
  if (cached) return { cookieStr: cached.cookieStr, nonce: cached.nonce };

  try {
    const loginPath = siteConfig.wp_login_path || '/wp-login.php';
    const normalizedLoginPath = loginPath.startsWith('http') ? loginPath : (loginPath.startsWith('/') ? loginPath : `/${loginPath}`);
    let loginUrl = normalizedLoginPath.startsWith('http') ? normalizedLoginPath : `${base}${normalizedLoginPath}`;
    const adminBase = getWpAdminPath(normalizedLoginPath);

    // Trích xuất Basic Auth credentials nếu có nhúng trong URL (http://user:pass@domain/path)
    let basicAuthHeader = '';
    try {
      const urlObj = new URL(loginUrl);
      if (urlObj.origin !== new URL(base).origin) throw new Error('URL đăng nhập phải thuộc cùng website WordPress.');
      if (urlObj.username && urlObj.password) {
        basicAuthHeader = 'Basic ' + Buffer.from(`${urlObj.username}:${urlObj.password}`).toString('base64');
        urlObj.username = '';
        urlObj.password = '';
        loginUrl = urlObj.toString();
      }
    } catch { return null; }

    // Lần 1: Thử login qua URL cấu hình (VD: /web_auth/, /hidden-login/, /wp-login.php)
    let result = await attemptWpLogin(loginUrl, siteConfig.wp_user, loginPass, basicAuthHeader, base, adminBase);

    // Lần 2: Nếu custom path fail → thử /wp-login.php chuẩn + Basic Auth header
    if (!result) {
      const isCustomPath = !loginUrl.includes('/wp-login.php');
      if (isCustomPath) {
        const standardLoginUrl = `${base}/wp-login.php`;
        const standardAdminBase = '/wp-admin';
        result = await attemptWpLogin(standardLoginUrl, siteConfig.wp_user, loginPass, basicAuthHeader, base, standardAdminBase);
      }
    }

    if (!result) {
      return null;
    }

    // Lưu vào cache
    if (sessionCache.size >= 100) sessionCache.delete(sessionCache.keys().next().value!);
    sessionCache.set(cacheKey, {
      ...result,
      timestamp: Date.now()
    });

    return result;
  } catch (e) {
    console.error('wpAuth error:', e);
    return null;
  }
}
