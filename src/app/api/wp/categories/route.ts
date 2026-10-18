import { errorMessage } from '@/lib/types';
import { readJson, errorStatus } from '@/lib/server/request';
import { withApiAuth } from '@/lib/server/auth';
import { safeFetch as fetch } from '@/lib/server/network';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  return withApiAuth(req, async () => {
  try {
    const body = await readJson(req);
    const { siteConfig } = body; 

    if (!siteConfig || !siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      return NextResponse.json({ success: false, message: "Thiếu thông tin kết nối" }, { status: 400 });
    }

    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    const headers = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*'
    };

    const endpoint = `${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/categories?per_page=100`;
    const response = await fetch(endpoint, {
      method: "GET",
      headers: headers
    });

    const responseText = await response.text();

    if (response.ok) {
      const categories = JSON.parse(responseText);
      return NextResponse.json({ success: true, categories: categories.map((c: { id: number; name: string }) => ({ id: c.id, name: c.name })) });
    } else {
      return NextResponse.json({ success: false, message: "Lỗi tải danh mục" }, { status: response.status });
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: errorMessage(error) }, { status: errorStatus(error) });
  }
  });
}
