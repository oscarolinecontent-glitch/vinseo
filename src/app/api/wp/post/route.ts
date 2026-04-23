import { NextResponse } from 'next/server';
import { parseGoogleDoc } from '@/lib/googleApi';
import { processAndUploadImages } from '@/lib/imageProcessor';

/**
 * Giả lập browser đăng nhập WP → lấy session cookie → lấy nonce → gọi Rank Math internal API
 * Đây là cách duy nhất bypass bảo vệ REST API meta của WordPress khi không có quyền Admin.
 */
async function updateRankMathViaAdminSession(
  objectId: number,
  objectType: 'post' | 'page' | 'category' | string,
  title: string,
  desc: string,
  keyword: string,
  siteConfig: any
) {
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const loginPass = siteConfig.wp_password; // Mật khẩu đăng nhập thực sự (khác app password)

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
  const loginPath = siteConfig.wp_login_path || '/wp-login.php';
  // Xử lý cả 2 trường hợp: full URL hoặc path tương đối
  const loginUrl = loginPath.startsWith('http') ? loginPath : `${base}${loginPath}`;
  const loginRes = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': 'wordpress_test_cookie=WP+Cookie+check',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': loginUrl,
        'Origin': base
      },
      body: loginForm.toString(),
      redirect: 'manual',
    });

    // Gom cookies từ response
    const rawCookies = loginRes.headers.getSetCookie?.() ?? [];
    const cookieStr = rawCookies.map((c: string) => c.split(';')[0]).join('; ');
    if (!cookieStr || !cookieStr.includes('wordpress_logged_in')) {
      console.error('RankMath Update: Đăng nhập WP thất bại, không nhận được cookie.');
      return;
    }

    // BƯỚC 2: Lấy nonce từ dashboard (wp-admin/)
    // Vì wpApiSettings.nonce thường có sẵn trên mọi trang admin, ta lấy từ trang chủ admin là chuẩn nhất
    const editPageRes = await fetch(`${base}/wp-admin/`, {
      headers: {
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const editPageHtml = await editPageRes.text();

    // Tìm nonce trong HTML (wp_rest nonce)
    const nonceMatch = editPageHtml.match(/"nonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/rankMath.*?"nonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/"restNonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/wpApiSettings.*?"nonce":"([a-f0-9]+)"/i);
    
    if (!nonceMatch) {
      console.error('RankMath Update: Không tìm thấy nonce trong trang editor.');
      return;
    }
    const nonce = nonceMatch[1];

    // BƯỚC 3: Gọi trực tiếp endpoint nội bộ của Rank Math
    const rmRes = await fetch(`${base}/wp-json/rankmath/v1/updateMeta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
        'X-WP-Nonce': nonce,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        objectID: objectId,
        objectType: objectType === 'category' ? 'term' : 'post',
        meta: {
          rank_math_title: title,
          rank_math_description: desc,
          rank_math_focus_keyword: keyword,
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
      if (!finalMetaDesc && parseResult.meta_desc) finalMetaDesc = parseResult.meta_desc;
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
      
      const endpoint = `${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/${endpointStr}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(wpPayload)
      });
      const responseText = await response.text();
      
      if (response.ok || response.status === 201) {
          const data = JSON.parse(responseText);
          if (data.id) {
            updateRankMathViaAdminSession(data.id, postType, finalTitle, finalMetaDesc, postData.keyword || '', siteConfig)
              .catch(e => console.error('RankMath update error:', e));
          }
          return NextResponse.json({ success: true, url: data.link, wp_id: data.id });
      } else {
          return NextResponse.json({ success: false, message: `Lỗi tạo category: ${response.status} - ${responseText}` }, { status: response.status });
      }

    } else {
      // XỬ LÝ POST / PAGE
      // Tạo slug từ keyword nếu có, nếu không lấy từ title
      const rawSlugText = postData.keyword || finalTitle;
      const finalSlug = postData.slug || (rawSlugText ? rawSlugText.toLowerCase().replace(/đ/g, 'd').replace(/[\s_]+/g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\-]/g, "") : 'auto-post');

      endpointStr = postType === 'page' ? 'pages' : 'posts';
      wpPayload = {
        title: finalTitle || 'Bài viết Auto generated',
        content: finalContent, // Gửi tạm content chưa xử lý ảnh để xí chỗ slug trước
        slug: finalSlug,
        status: postData.status || "draft",
        meta: {
          rank_math_title: finalTitle,
          rank_math_description: finalMetaDesc,
          rank_math_focus_keyword: postData.keyword || ""
        }
      };
      
      if (postType === 'post') {
        wpPayload.excerpt = finalMetaDesc;
        if (postData.categoryId) {
          wpPayload.categories = [postData.categoryId];
        }
      }

      // BƯỚC 1: TẠO BÀI VIẾT ĐỂ CHIẾM SLUG
      const endpoint = `${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/${endpointStr}`;
      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(wpPayload)
        });
      } catch (fetchError: any) {
        throw new Error(`Không thể kết nối tới Website WordPress (${siteConfig.wp_url}). Vui lòng kiểm tra lại đường truyền mạng hoặc kiểm tra xem Website có chặn truy cập không. Chi tiết: ${fetchError.message}`);
      }

      const responseText = await response.text();

      if (!(response.ok || response.status === 201)) {
        let errorMessage = `HTTP Error ${response.status}`;
        try {
          const err = JSON.parse(responseText);
          errorMessage = err.message || errorMessage;
        } catch (e) {
          errorMessage = `Lỗi từ Server WP (Mã ${response.status}). Máy chủ trả về HTML thay vì JSON.`;
        }
        return NextResponse.json({ success: false, message: errorMessage }, { status: response.status });
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        return NextResponse.json({ success: false, message: "WP trả về dữ liệu không hợp lệ." }, { status: 500 });
      }

      const postId = data.id;

      // BƯỚC 2: UPLOAD ẢNH & THUMBNAIL 
      // Do bài viết đã chiếm thành công slug, tên file ảnh trùng slug sẽ không ảnh hưởng bài viết nữa
      const imageProcessResult = await processAndUploadImages(finalContent, thumbUrl, finalSlug, rawSlugText, siteConfig);
      
      // BƯỚC 3: CẬP NHẬT LẠI BÀI VIẾT VỚI NỘI DUNG ĐÃ CÓ ẢNH & GẮN FEATURED MEDIA
      await fetch(`${endpoint}/${postId}`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          content: imageProcessResult.processedHtml,
          featured_media: imageProcessResult.thumbnailId || 0
        })
      });

      // Ép đè RankMath meta
      updateRankMathViaAdminSession(postId, postType, finalTitle, finalMetaDesc, postData.keyword || '', siteConfig)
        .catch(e => console.error('RankMath update background error:', e));

      return NextResponse.json({ success: true, url: data.link, wp_id: postId });
    }

  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
