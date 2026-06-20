import { NextResponse } from 'next/server';
import { getWpAdminSession } from '@/lib/wpAuth';

export const maxDuration = 60; 

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    
    const file = formData.get('file') as File;
    const filename = formData.get('filename') as string;
    const siteConfigStr = formData.get('siteConfig') as string;

    if (!file || !filename || !siteConfigStr) {
      return NextResponse.json({ success: false, message: 'Thiếu dữ liệu upload.' }, { status: 400 });
    }

    const siteConfig = JSON.parse(siteConfigStr);

    if (!siteConfig?.wp_url || !siteConfig?.wp_user || !siteConfig?.wp_app_pass) {
      return NextResponse.json({ success: false, message: 'Thiếu thông tin cấu hình WP.' }, { status: 400 });
    }

    // Normalize WP URL
    let urlToUse = siteConfig.wp_url.trim();
    if (!urlToUse.startsWith('http://') && !urlToUse.startsWith('https://')) {
      urlToUse = 'https://' + urlToUse;
    }
    siteConfig.wp_url = urlToUse;

    // Check WP Auth
    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    let authHeaders: any = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': file.type || 'image/jpeg',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'User-Agent': 'Mozilla/5.0'
    };

    const baseWpUrl = siteConfig.wp_url.replace(/\/$/, '');
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to WP (Try Basic Auth first)
    let uploadRes = await fetch(`${baseWpUrl}/wp-json/wp/v2/media`, {
       method: 'POST',
       headers: authHeaders,
       body: buffer as any
    });

    if (uploadRes.status === 401 || uploadRes.status === 403) {
      // Try to get cookie auth if basic auth fails (e.g. blocked by security plugin)
      const session = await getWpAdminSession(siteConfig);
      if (session) {
        authHeaders = {
          'Cookie': session.cookieStr,
          'X-WP-Nonce': session.nonce,
          'Content-Type': file.type || 'image/jpeg',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
          'User-Agent': 'Mozilla/5.0'
        };
        // Retry Upload
        uploadRes = await fetch(`${baseWpUrl}/wp-json/wp/v2/media`, {
           method: 'POST',
           headers: authHeaders,
           body: buffer as any
        });
      } else {
         return NextResponse.json({ success: false, message: 'Không thể xác thực với WordPress.' }, { status: 401 });
      }
    }

    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      throw new Error(`Upload failed (HTTP ${uploadRes.status}): ${errorText.substring(0, 100)}`);
    }

    const newMedia = await uploadRes.json();

    return NextResponse.json({
      success: true,
      mediaId: newMedia.id,
      sourceUrl: newMedia.source_url
    });

  } catch (error: any) {
    console.error('API /api/wp/upload-media Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
