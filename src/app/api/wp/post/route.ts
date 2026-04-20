import { NextResponse } from 'next/server';
import { parseGoogleDoc } from '@/lib/googleApi';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { siteConfig, postData } = body; 

    // Xử lý tạo Token Base64 từ credential
    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');

    const headers = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    };

    let finalTitle = postData.title;
    let finalContent = "";

    // Thực hiện Parse Google Doc nếu user có gửi link
    if (postData.gdoc_url) {
      const parseResult = await parseGoogleDoc(postData.gdoc_url);
      if (!parseResult.success) {
        return NextResponse.json({ success: false, message: parseResult.message }, { status: 400 });
      }
      if (!finalTitle) finalTitle = parseResult.title || "";
      finalContent = parseResult.content || "";
    } else {
      return NextResponse.json({ success: false, message: "Thiếu link Google Docs" }, { status: 400 });
    }

    const postType = postData.postType || 'post'; // 'post', 'page', 'category'

    let wpPayload: any = {};
    let endpointStr = 'posts';

    if (postType === 'category') {
      endpointStr = 'categories';
      wpPayload = {
        name: finalTitle || 'Chuyên mục Auto',
        description: finalContent,
        slug: postData.slug || (finalTitle ? finalTitle.toLowerCase().replace(/ /g, '-') : 'auto-cat'),
      };
    } else {
      endpointStr = postType === 'page' ? 'pages' : 'posts';
      wpPayload = {
        title: finalTitle || 'Bài viết Auto generated',
        content: finalContent,
        slug: postData.slug || (finalTitle ? finalTitle.toLowerCase().replace(/ /g, '-') : 'auto-post'),
        status: postData.status || "draft",
        excerpt: postData.meta_desc
      };
      
      // Chỉ truyền category cho Post (Page không có Category)
      if (postType === 'post' && postData.categoryId) {
        wpPayload.categories = [postData.categoryId];
      }
    }
    
    // (Lưu ý: Logic Thumb/Media sẽ phải bóc tách riêng và gửi GET trước theo id, giả định ta gán id=null tại đây để test flow)

    const endpoint = `${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/${endpointStr}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(wpPayload)
    });

    const responseText = await response.text();

    if (response.ok || response.status === 201) {
      try {
        const data = JSON.parse(responseText);
        return NextResponse.json({ success: true, url: data.link, wp_id: data.id });
      } catch (parseError) {
        if (responseText.includes('aes.js')) {
          return NextResponse.json({ success: false, message: "Host bị chặn bởi Javascript Challenge (InfinityFree/ByetHost). Vui lòng dùng Hosting trả phí." }, { status: 500 });
        }
        return NextResponse.json({ success: false, message: "WP trả về dữ liệu không hợp lệ (Không phải định dạng JSON). Có thể do xung đột plugin hoặc URL không đúng." }, { status: 500 });
      }
    } else {
      let errorMessage = `HTTP Error ${response.status}`;
      try {
        const err = JSON.parse(responseText);
        errorMessage = err.message || errorMessage;
      } catch (e) {
        // Fallback for HTML error pages
        errorMessage = `Lỗi từ Server WP (Mã ${response.status}). Máy chủ trả về HTML thay vì JSON. Có thể do sai URL cấu hình, sai link wp-json, hoặc bị chặn bởi Firewall (Cloudflare/Wordfence).`;
      }
      return NextResponse.json({ success: false, message: errorMessage }, { status: response.status });
    }

  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
