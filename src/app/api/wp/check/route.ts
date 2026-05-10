import { NextResponse } from 'next/server';
import { getWpAdminSession } from '@/lib/wpAuth';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { siteConfig } = body; 

    if (!siteConfig || !siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      return NextResponse.json({ success: false, message: "Thiếu thông tin kết nối" }, { status: 400 });
    }

    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    const headers: any = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    const endpoint = `${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/users/me`;
    let response = await fetch(endpoint, {
      method: "GET",
      headers: headers
    });

    // NẾU BASIC AUTH BỊ CHẶN BỞI WAF (LỖI 401 HOẶC 403), THỬ COOKIE AUTH FALLBACK
    let usingCookieAuth = false;
    if (!response.ok) {
      console.log('checkConnection: Basic Auth failed, trying Cookie fallback...');
      const session = await getWpAdminSession(siteConfig);
      if (session) {
        const cookieHeaders = {
          'Cookie': session.cookieStr,
          'X-WP-Nonce': session.nonce,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };
        const fallbackResponse = await fetch(endpoint, {
          method: "GET",
          headers: cookieHeaders
        });
        if (fallbackResponse.ok) {
          response = fallbackResponse;
          usingCookieAuth = true;
          console.log('checkConnection: Cookie fallback SUCCESS');
        }
      }
    }

    const responseText = await response.text();

    if (response.ok) {
      try {
        const data = JSON.parse(responseText);
        return NextResponse.json({ 
          success: true, 
          message: usingCookieAuth ? "Kết nối thành công (Bypass WAF bằng Session)!" : "Kết nối thành công!", 
          user: data.name,
          usingCookieAuth 
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
        const err = JSON.parse(responseText);
        errorMessage = err.message || errorMessage;
      } catch (e) {
        errorMessage = `Lỗi kết nối (Mã ${response.status}). Cả Basic Auth và Session Login đều thất bại, bị Firewall chặn hoàn toàn.`;
      }
      return NextResponse.json({ success: false, message: errorMessage }, { status: response.status });
    }

  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
