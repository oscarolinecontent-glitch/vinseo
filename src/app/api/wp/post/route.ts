import { NextResponse } from 'next/server';
import { parseGoogleDoc } from '@/lib/googleApi';
import { processAndUploadImages } from '@/lib/imageProcessor';

/**
 * Giả lập browser đăng nhập WP → lấy session cookie → lấy nonce → gọi Rank Math internal API
 * Đây là cách duy nhất bypass bảo vệ REST API meta của WordPress khi không có quyền Admin.
 */
async function updateRankMathViaAdminSession(
  postId: number,
  title: string,
  desc: string,
  keyword: string,
  postType: string,
  siteConfig: any
) {
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const loginPath = siteConfig.wp_login_path
    ? siteConfig.wp_login_path.replace(/^\//, '') // bỏ dấu / đầu nếu có
    : 'wp-login.php';
  const loginPass = siteConfig.wp_password;

  if (!loginPass) {
    console.warn('RankMath Update: Không có wp_password, bỏ qua.');
    return;
  }

  try {
    // BƯỚC 1: Đăng nhập vào wp-login.php để lấy session cookie
    const loginForm = new URLSearchParams({
      log: siteConfig.wp_user,
      pwd: loginPass,
      'wp-submit': 'Log+In',
      redirect_to: `/wp-admin/`,
      testcookie: '1',
    });
    const loginRes = await fetch(`${base}/${loginPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': 'wordpress_test_cookie=WP+Cookie+check',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: loginForm.toString(),
      redirect: 'manual',
    });

    // Gom cookies từ response
    const rawCookies = loginRes.headers.getSetCookie?.() ?? [];
    const cookieStr = rawCookies.map((c: string) => c.split(';')[0]).join('; ');
    
    if (!cookieStr || !cookieStr.includes('wordpress_logged_in')) {
      const errorBody = await loginRes.text();
      console.error(`RankMath Update: Đăng nhập thất bại (Status: ${loginRes.status}).`);
      if (loginRes.status === 404) console.error("-> Lỗi 404: Có thể web đã đổi đường dẫn đăng nhập (WPS Hide Login).");
      if (errorBody.includes('reCAPTCHA') || errorBody.includes('captcha')) console.error("-> Lỗi: Web có CAPTCHA chặn đăng nhập tự động.");
      return;
    }

    // BƯỚC 2: Lấy nonce từ trang editor của bài viết
    const editPageRes = await fetch(`${base}/wp-admin/post.php?post=${postId}&action=edit`, {
      headers: {
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const editPageHtml = await editPageRes.text();

    // Tìm nonce trong HTML (truy quét sâu trong script tags)
    const nonceMatch = editPageHtml.match(/"nonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/rankMath.*?"nonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/"restNonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/wpApiSettings.*?"nonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/rank_math_common_nonce":"([a-f0-9]+)"/i);
    
    if (!nonceMatch) {
      console.error('RankMath Update: Không tìm thấy nonce. Thử tìm trong script tags...');
      // Fallback: Tìm trong toàn bộ văn bản bất cứ thứ gì trông giống nonce của RankMath
      const anyNonce = editPageHtml.match(/[a-f0-9]{10}/i); // Nonce WP thường dài 10 ký tự hex
      if (!anyNonce) return;
    }
    const nonce = nonceMatch ? nonceMatch[1] : (editPageHtml.match(/[a-f0-9]{10}/i)?.[0] || "");

    // BƯỚC 3: Gọi trực tiếp endpoint nội bộ của Rank Math với payload "cực đoan"
    const rmRes = await fetch(`${base}/wp-json/rankmath/v1/updateMeta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
        'X-WP-Nonce': nonce,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        objectID: postId,
        objectType: postType === 'page' ? 'page' : 'post',
        meta: {
          rank_math_title: title,
          rank_math_description: desc,
          rank_math_focus_keyword: keyword,
          // Gửi thêm biến thể có dấu gạch dưới nếu cần
          _rank_math_title: title,
          _rank_math_description: desc,
          _rank_math_focus_keyword: keyword,
        },
      }),
    });
    const rmData = await rmRes.text();
    console.log('RankMath Admin Session Update:', rmRes.status, rmData.slice(0, 200));
  } catch (e) {
    console.error('RankMath Admin Session Update Failed:', e);
  }
}

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
    let finalMetaDesc = postData.meta_desc || "";
    let driveLink = "";
    let thumbUrl = "";

    // Thực hiện Parse Google Doc nếu user có gửi link
    if (postData.gdoc_url) {
      const parseResult = await parseGoogleDoc(postData.gdoc_url);
      if (!parseResult.success) {
        return NextResponse.json({ success: false, message: parseResult.message }, { status: 400 });
      }
      if (!finalTitle) finalTitle = parseResult.title || "";
      if (parseResult.meta_desc) finalMetaDesc = parseResult.meta_desc;
      driveLink = parseResult.drive_link || "";
      finalContent = parseResult.content || "";
      thumbUrl = parseResult.thumb_url || "";
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
      // Tạo slug từ keyword nếu có, nếu không lấy từ title
      const rawSlugText = postData.keyword || finalTitle;
      const finalSlug = postData.slug || (rawSlugText ? rawSlugText.toLowerCase().replace(/đ/g, 'd').replace(/[\s_]+/g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\-]/g, "") : 'auto-post');

      // --- TÍCH HỢP TOOL 7 (XỬ LÝ ẢNH) ---
      // finalSlug lúc này là keyword slug hoàn hảo (vd: the-thao-kong88)
      const imageProcessResult = await processAndUploadImages(finalContent, thumbUrl, finalSlug, rawSlugText, siteConfig, postData.imageFormat);
      
      finalContent = imageProcessResult.processedHtml;
      const featuredMediaId = imageProcessResult.thumbnailId;

      endpointStr = postType === 'page' ? 'pages' : 'posts';
      wpPayload = {
        title: finalTitle || 'Bài viết Auto generated',
        content: finalContent,
        slug: finalSlug,
        status: postData.status || "draft",
        featured_media: featuredMediaId,
        meta: {
          rank_math_title: finalTitle,
          rank_math_description: finalMetaDesc,
          rank_math_focus_keyword: postData.keyword || ""
        }
      };
      
      // Chỉ truyền category cho Post (Page không có Category)
      if (postType === 'post' && postData.categoryId) {
        wpPayload.categories = [postData.categoryId];
      }
    }
    
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
        
        // Ép đè RankMath bằng kỹ thuật giả lập Admin Session (bypass REST API meta block)
        if (postType !== 'category' && data.id) {
          updateRankMathViaAdminSession(data.id, finalTitle, finalMetaDesc, postData.keyword || '', postType, siteConfig)
            .catch(e => console.error('RankMath update background error:', e));
        }

        return NextResponse.json({ success: true, url: data.link, wp_id: data.id });
      } catch (parseError) {
        if (responseText.includes('aes.js')) {
          return NextResponse.json({ success: false, message: "Host bị chặn bởi Javascript Challenge (InfinityFree/ByetHost)." }, { status: 500 });
        }
        return NextResponse.json({ success: false, message: "WP trả về dữ liệu không hợp lệ." }, { status: 500 });
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
