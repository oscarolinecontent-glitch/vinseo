import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { siteConfig } = body; 

    if (!siteConfig || !siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      return NextResponse.json({ success: false, message: "Thiếu thông tin kết nối" }, { status: 400 });
    }

    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    const headers = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    };

    const endpoint = `${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/users/me`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: headers
    });

    const responseText = await response.text();

    if (response.ok) {
      try {
        const data = JSON.parse(responseText);
        return NextResponse.json({ success: true, message: "Kết nối thành công!", user: data.name });
      } catch (parseError) {
        if (responseText.includes('aes.js')) {
          return NextResponse.json({ 
            success: false, 
            message: `⚠️ BỊ HOSTING CHẶN: Website của bạn đang dùng Hosting miễn phí (InfinityFree, ByetHost...) hoặc có Firewall chống DDoS quá mạnh. Host này bắt buộc trình duyệt phải chạy file 'aes.js' để vượt qua. Vì Tool của chúng ta chạy trên Server/Localhost nên bị chặn hoàn toàn.\n💡 Giải pháp: Đổi sang Hosting thật (trả phí) hoặc Deploy ứng dụng này lên Vercel để mượn IP uy tín của máy chủ.` 
          }, { status: 500 });
        }

        const preview = responseText.substring(0, 150).replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return NextResponse.json({ 
          success: false, 
          message: `Kết nối trả về mã 200 (OK) nhưng dữ liệu không phải JSON. Có thể do Cloudflare chặn hoặc URL không đúng chuẩn REST API. Dữ liệu nhận được: ${preview}...` 
        }, { status: 500 });
      }
    } else {
      let errorMessage = `HTTP Error ${response.status}`;
      try {
        const err = JSON.parse(responseText);
        errorMessage = err.message || errorMessage;
      } catch (e) {
        errorMessage = `Lỗi kết nối (Mã ${response.status}). URL có thể bị sai hoặc firewall chặn.`;
      }
      return NextResponse.json({ success: false, message: errorMessage }, { status: response.status });
    }

  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
