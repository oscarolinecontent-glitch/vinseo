// Lưu cache session trong bộ nhớ của server để tránh spam wp-login.php liên tục gây lỗi 1006
const sessionCache: Record<string, { cookieStr: string, nonce: string, timestamp: number }> = {};

export async function getWpAdminSession(siteConfig: any): Promise<{ cookieStr: string, nonce: string } | null> {
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const loginPass = siteConfig.wp_password || siteConfig.wp_app_pass; // Fallback to app_pass if wp_password is not set

  if (!loginPass || !siteConfig.wp_user) {
    console.warn('wpAuth: Missing wp_user or password.');
    return null;
  }

  // Khóa cache dựa trên url và username
  const cacheKey = `${base}_${siteConfig.wp_user}`;
  const now = Date.now();
  if (sessionCache[cacheKey] && (now - sessionCache[cacheKey].timestamp < 2 * 60 * 60 * 1000)) {
    // Tái sử dụng cache nếu chưa quá 2 tiếng
    return { cookieStr: sessionCache[cacheKey].cookieStr, nonce: sessionCache[cacheKey].nonce };
  }

  try {
    const loginForm = new URLSearchParams({
      log: siteConfig.wp_user,
      pwd: loginPass,
      'wp-submit': 'Log+In',
      redirect_to: `/wp-admin/`,
      testcookie: '1',
    });

    const loginPath = siteConfig.wp_login_path || '/wp-login.php';
    // Normalize: nếu không phải URL đầy đủ mà thiếu dấu / ở đầu thì tự thêm vào
    const normalizedLoginPath = loginPath.startsWith('http') ? loginPath : (loginPath.startsWith('/') ? loginPath : `/${loginPath}`);
    let loginUrl = normalizedLoginPath.startsWith('http') ? normalizedLoginPath : `${base}${normalizedLoginPath}`;

    let basicAuthHeader = '';
    try {
      const urlObj = new URL(loginUrl);
      if (urlObj.username && urlObj.password) {
        basicAuthHeader = 'Basic ' + Buffer.from(`${urlObj.username}:${urlObj.password}`).toString('base64');
        urlObj.username = '';
        urlObj.password = '';
        loginUrl = urlObj.toString();
      }
    } catch (e) { }

    const headers: any = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': 'wordpress_test_cookie=WP+Cookie+check',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Connection': 'close',
      'Referer': loginUrl,
      'Origin': base
    };

    if (basicAuthHeader) {
      headers['Authorization'] = basicAuthHeader;
    }

    const loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: headers,
      body: loginForm.toString(),
      redirect: 'manual',
    });

    let cookieStr = '';
    const rawCookies = loginRes.headers.getSetCookie?.() ?? [];
    if (rawCookies.length > 0) {
      cookieStr = rawCookies.map((c: string) => c.split(';')[0]).join('; ');
    } else {
      const setCookieStr = loginRes.headers.get('set-cookie');
      if (setCookieStr) {
        cookieStr = setCookieStr; // fallback for Next.js environments where getSetCookie is missing
      }
    }

    if (!cookieStr || !cookieStr.includes('wordpress_logged_in')) {
      const errorHtml = await loginRes.text();
      const location = loginRes.headers.get('location') || '';
      console.error(`wpAuth: Login failed (Status: ${loginRes.status}), no wordpress_logged_in cookie.`);
      if (location) console.error(`wpAuth: Redirected to: ${location}`);
      console.error(`wpAuth: Set-Cookie: ${loginRes.headers.get('set-cookie')}`);
      console.error(`wpAuth: Response preview: ${errorHtml.slice(0, 150)}...`);
      return null;
    }

    const editHeaders: any = {
      'Cookie': cookieStr,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Connection': 'close',
    };
    if (basicAuthHeader) {
      editHeaders['Authorization'] = basicAuthHeader;
    }

    const editPageRes = await fetch(`${base}/wp-admin/post-new.php`, {
      headers: editHeaders,
    });
    const editPageHtml = await editPageRes.text();

    // Ưu tiên lấy nonce chuẩn của WordPress REST API (wpApiSettings) thay vì nonce của các plugin khác
    // Dùng [\s\S]*? thay vì .*? để khớp qua nhiều dòng (dotAll)
    const nonceMatch = editPageHtml.match(/wpApiSettings[\s\S]*?"nonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/"restNonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/rankMath[\s\S]*?"nonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/"nonce":"([a-f0-9]+)"/i);

    if (!nonceMatch) {
      console.error('wpAuth: Nonce not found in wp-admin html.');
      return null;
    }

    const result = { cookieStr, nonce: nonceMatch[1] };

    // Lưu vào cache
    sessionCache[cacheKey] = {
      ...result,
      timestamp: Date.now()
    };

    return result;
  } catch (e) {
    console.error('wpAuth error:', e);
    return null;
  }
}
