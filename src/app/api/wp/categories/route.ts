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
      return NextResponse.json({ success: true, categories: categories.map((c: any) => ({ id: c.id, name: c.name })) });
    } else {
      return NextResponse.json({ success: false, message: "Lỗi tải danh mục" }, { status: response.status });
    }
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
