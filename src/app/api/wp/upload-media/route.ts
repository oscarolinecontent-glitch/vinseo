import sharp from 'sharp';
import { readBody, validateSiteConfig, InputError, errorStatus } from '@/lib/server/request';
import { errorMessage } from '@/lib/types';
import { withApiAuth } from '@/lib/server/auth';
import { safeFetch as fetch } from '@/lib/server/network';
import { NextResponse } from 'next/server';
import { getWpAdminSession } from '@/lib/wpAuth';

export const maxDuration = 300;

export async function POST(req: Request) {
  return withApiAuth(req, async () => {
  try {
    const bytes = await readBody(req, 4 * 1024 * 1024 + 64 * 1024);
    const formData = await new Response(bytes as BodyInit, { headers: { 'content-type': req.headers.get('content-type') || '' } }).formData();
    
    const file = formData.get('file');
    const filename = formData.get('filename') as string;
    const siteConfigStr = formData.get('siteConfig') as string;

    if (!(file instanceof File) || !filename || !siteConfigStr) {
      return NextResponse.json({ success: false, message: 'Thiếu dữ liệu upload.' }, { status: 400 });
    }

    if (file.size > 4 * 1024 * 1024) throw new InputError('Ảnh vượt giới hạn 4 MB.');
    const metadata = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.format || !['jpeg', 'png', 'webp', 'gif'].includes(metadata.format)) throw new InputError('Chỉ hỗ trợ JPEG, PNG, WebP, GIF.');
    const contentType = `image/${metadata.format}`;
    const siteConfig = validateSiteConfig(JSON.parse(siteConfigStr));

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
    let authHeaders: Record<string, string> = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': contentType,
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
       body: new Uint8Array(buffer)
    });

    if (uploadRes.status === 401 || uploadRes.status === 403) {
      // Try to get cookie auth if basic auth fails (e.g. blocked by security plugin)
      const session = await getWpAdminSession(siteConfig);
      if (session) {
        authHeaders = {
          'Cookie': session.cookieStr,
          'X-WP-Nonce': session.nonce,
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
          'User-Agent': 'Mozilla/5.0'
        };
        // Retry Upload
        uploadRes = await fetch(`${baseWpUrl}/wp-json/wp/v2/media`, {
           method: 'POST',
           headers: authHeaders,
           body: new Uint8Array(buffer)
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

  } catch (error) {
    console.error('API /api/wp/upload-media Error:', error);
    return NextResponse.json({ success: false, message: errorMessage(error) }, { status: errorStatus(error) });
  }
  });
}
