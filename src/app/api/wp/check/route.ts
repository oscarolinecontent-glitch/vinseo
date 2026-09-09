import { NextResponse } from 'next/server';
import dns from 'dns';

// Fix lỗi timeout do Node.js ưu tiên IPv6 nhưng mạng 4G/NAT64 bị kẹt (bug của fetch/undici)
dns.setDefaultResultOrder('ipv4first');
import { getWpAdminSession } from '@/lib/wpAuth';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { siteConfig } = body; 

    if (!siteConfig || !siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      return NextResponse.json({ success: false, message: "Thiếu thông tin kết nối" }, { status: 400 });
    }

    let urlToUse = siteConfig.wp_url.trim();
    if (!urlToUse.startsWith('http://') && !urlToUse.startsWith('https://')) {
      urlToUse = 'https://' + urlToUse;
    }
    siteConfig.wp_url = urlToUse; // normalize trước khi dùng trong getWpAdminSession

    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    const headers: any = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Connection': 'close'
    };

    const base = urlToUse.replace(/\/$/, "");
    const endpoint = `${base}/wp-json/wp/v2/users/me`;
    let response = await fetch(endpoint, { method: "GET", headers });

    // NẾU BASIC AUTH BỊ CHẶN BỞI WAF (LỖI 401 HOẶC 403), THỬ COOKIE AUTH FALLBACK
    let usingCookieAuth = false;
    let cookieAuthUser = '';

    if (!response.ok) {
      console.log('checkConnection: Basic Auth failed, trying Cookie fallback...');
      const session = await getWpAdminSession(siteConfig);
      if (session) {
        const cookieHeaders: any = {
          'Cookie': session.cookieStr,
          'X-WP-Nonce': session.nonce,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Connection': 'close'
        };

        // Thử các endpoint theo thứ tự quyền hạn giảm dần
        // /users/me yêu cầu list_users → bị chặn với siteeditor/editor role
        const candidateEndpoints = [
          { url: `${base}/wp-json/wp/v2/users/me`, getName: (d: any) => d.name },
          { url: `${base}/wp-json/wp/v2/posts?per_page=1&status=any`, getName: () => siteConfig.wp_user },
          { url: `${base}/wp-json/wp/v2/media?per_page=1`, getName: () => siteConfig.wp_user },
          { url: `${base}/wp-json/wp/v2/types`, getName: () => siteConfig.wp_user },
        ];

        for (const candidate of candidateEndpoints) {
          const r = await fetch(candidate.url, { method: 'GET', headers: cookieHeaders });
          if (r.ok) {
            try {
              const d = await r.json();
              cookieAuthUser = candidate.getName(d) || siteConfig.wp_user;
            } catch { cookieAuthUser = siteConfig.wp_user; }
            response = r;
            usingCookieAuth = true;
            console.log('checkConnection: Cookie fallback SUCCESS');
            break;
          }
        }
      }
    }

    if (response.ok) {
      if (usingCookieAuth) {
        return NextResponse.json({
          success: true,
          message: "Kết nối thành công (Cookie Auth)",
          user: cookieAuthUser,
          usingCookieAuth: true
        });
      }
      const responseText = await response.text();
      try {
        const data = JSON.parse(responseText);
        return NextResponse.json({ 
          success: true, 
          message: "Kết nối thành công!", 
          user: data.name,
          usingCookieAuth: false
        });
      } catch (parseError) {
        if (responseText.includes('aes.js')) {
          return NextResponse.json({ 
            success: false, 
            message: `⚠️ BỊ HOSTING CHẶN: Website của bạn đang dùng Hosting miễn phí hoặc Firewall chống DDoS mạnh. Tool không vượt qua được.` 
          }, { status: 500 });
        }
        const preview = responseText.substring(0, 150).replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return NextResponse.json({ 
          success: false, 
          message: `Kết nối trả về mã 200 nhưng dữ liệu không phải JSON. Cloudflare chặn? Dữ liệu: ${preview}...` 
        }, { status: 500 });
      }
    } else {
      let errorMessage = `HTTP Error ${response.status}`;
      try {
        const err = JSON.parse(await response.text());
        errorMessage = err.message || errorMessage;
      } catch (e) {
        errorMessage = `Lỗi kết nối (Mã ${response.status}). Cả Basic Auth và Session Login đều thất bại, bị Firewall chặn hoàn toàn.`;
      }
      return NextResponse.json({ success: false, message: errorMessage }, { status: response.status });
    }

  } catch (error: any) {
    console.error('API /api/wp/check Unhandled Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
