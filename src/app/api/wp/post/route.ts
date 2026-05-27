import { NextResponse } from 'next/server';
import dns from 'dns';

// Fix lỗi timeout do Node.js ưu tiên IPv6 nhưng mạng 4G/NAT64 bị kẹt (bug của fetch/undici)
dns.setDefaultResultOrder('ipv4first');
import { parseGoogleDoc } from '@/lib/googleApi';
import { processAndUploadImages, processImagesByCaption } from '@/lib/imageProcessor';
import { getWpAdminSession } from '@/lib/wpAuth';

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
  categoryId: string | number,
  siteConfig: any
) {
  try {
    const session = await getWpAdminSession(siteConfig);
    const base = siteConfig.wp_url.replace(/\/$/, '');

    // Headers gọi Rank Math API
    const rmHeaders: any = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 VinSeoBot/1.0',
      'Connection': 'close',
    };

    if (session) {
      rmHeaders['Cookie'] = session.cookieStr;
      rmHeaders['X-WP-Nonce'] = session.nonce;
      console.log('RankMath Update: Dùng Session Admin (Cookie).');
    } else {
      console.warn('RankMath Update: Không lấy được session admin (bị Cloudflare hoặc lỗi khác). Fallback dùng Basic Auth...');
      const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
      rmHeaders['Authorization'] = `Basic ${credentials}`;
    }

    // Thêm Basic Auth phụ nếu login path có nhúng credentials (http://user:pass@domain.com/wp-login.php)
    const loginPath = siteConfig.wp_login_path || '/wp-login.php';
    const normalizedLoginPath = loginPath.startsWith('http') ? loginPath : (loginPath.startsWith('/') ? loginPath : `/${loginPath}`);
    const loginUrl = normalizedLoginPath.startsWith('http') ? normalizedLoginPath : `${base}${normalizedLoginPath}`;
    try {
      const urlObj = new URL(loginUrl);
      if (urlObj.username && urlObj.password) {
        rmHeaders['Authorization'] = 'Basic ' + Buffer.from(`${urlObj.username}:${urlObj.password}`).toString('base64');
      }
    } catch (e) { }

    const rmRes = await fetch(`${base}/wp-json/rankmath/v1/updateMeta`, {
      method: 'POST',
      headers: rmHeaders,
      body: JSON.stringify({
        objectID: objectId,
        objectType: objectType === 'category' ? 'term' : 'post',
        meta: {
          rank_math_title: title,
          rank_math_description: desc,
          rank_math_focus_keyword: keyword,
          rank_math_primary_category: categoryId ? parseInt(categoryId.toString(), 10) : 0
        },
      }),
    });
    const rmData = await rmRes.text();
    console.log('RankMath Update Result:', rmRes.status, rmData.slice(0, 200));
  } catch (e) {
    console.error('RankMath Update Failed:', e);
  }
}

/**
 * Hàm cập nhật Category Description qua giao diện wp-admin để tránh bị REST API tự động xóa thẻ HTML
 */
async function updateCategoryDescriptionViaAdmin(
  categoryId: number,
  title: string,
  slug: string,
  descriptionHtml: string,
  siteConfig: any
) {
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const session = await getWpAdminSession(siteConfig);

  if (!session) {
    console.warn('Update Category HTML: Không lấy được session admin. Fallback cập nhật qua REST API...');
    try {
      const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
      const res = await fetch(`${base}/wp-json/wp/v2/categories/${categoryId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 VinSeoBot/1.0',
          'Connection': 'close'
        },
        body: JSON.stringify({
          description: descriptionHtml
        })
      });
      console.log(`Update Category HTML (${categoryId}) via REST Fallback: Status ${res.status}`);
    } catch (err) {
      console.error('Update Category HTML REST Fallback Failed:', err);
    }
    return;
  }

  try {
    // 1. Fetch trang edit-tags.php để lấy form nonce
    const editUrl = `${base}/wp-admin/term.php?taxonomy=category&tag_ID=${categoryId}&post_type=post`;
    const getRes = await fetch(editUrl, {
      headers: {
        'Cookie': session.cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 VinSeoBot/1.0',
        'Connection': 'close'
      }
    });
    const html = await getRes.text();

    // Tìm _wpnonce cho form edit tag
    const nonceMatch = html.match(/<input type="hidden" id="_wpnonce" name="_wpnonce" value="([^"]+)"/);
    if (!nonceMatch) {
      console.warn('Update Category HTML: Không tìm thấy _wpnonce trên trang term.php.');
      return;
    }
    const formNonce = nonceMatch[1];

    // 2. Submit form lên edit-tags.php
    const formData = new URLSearchParams();
    formData.append('action', 'editedtag');
    formData.append('tag_ID', categoryId.toString());
    formData.append('taxonomy', 'category');
    formData.append('_wpnonce', formNonce);
    formData.append('name', title);
    formData.append('slug', slug);
    formData.append('description', descriptionHtml);

    const postRes = await fetch(`${base}/wp-admin/edit-tags.php`, {
      method: 'POST',
      headers: {
        'Cookie': session.cookieStr,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 VinSeoBot/1.0',
        'Connection': 'close',
        'Referer': editUrl
      },
      body: formData.toString()
    });

    console.log(`Update Category HTML (${categoryId}) via Admin: Status ${postRes.status}`);
  } catch (e) {
    console.error('Update Category HTML Failed:', e);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { siteConfig, postData } = body;

    if (!siteConfig || !siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      return NextResponse.json({ success: false, message: "Thiếu thông tin kết nối (siteConfig)" }, { status: 400 });
    }

    let urlToUse = siteConfig.wp_url.trim();
    if (!urlToUse.startsWith('http://') && !urlToUse.startsWith('https://')) {
      urlToUse = 'https://' + urlToUse;
    }
    siteConfig.wp_url = urlToUse; // Update it so subsequent functions use the right URL

    // Xử lý tạo Token Base64 từ credential
    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');

    let headers: any = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 VinSeoBot/1.0',
      'Connection': 'close'
    };

    // Kiểm tra xem Basic Auth có bị Firewall chặn không (giống checkConnection)
    const checkEndpoint = `${urlToUse.replace(/\/$/, "")}/wp-json/wp/v2/users/me`;
    const checkRes = await fetch(checkEndpoint, { method: "GET", headers });
    if (!checkRes.ok) {
      console.log('WP POST: Basic Auth failed, trying Cookie fallback...');
      const session = await getWpAdminSession(siteConfig);
      if (session) {
        // Nếu lấy được session, dùng Session thay thế cho Basic Auth
        headers = {
          'Cookie': session.cookieStr,
          'X-WP-Nonce': session.nonce,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 VinSeoBot/1.0',
          'Connection': 'close'
        };
        // Lưu vào siteConfig để truyền cho imageProcessor
        siteConfig.authHeaders = {
          'Cookie': session.cookieStr,
          'X-WP-Nonce': session.nonce
        };
      } else {
        console.error('WP POST: Cả Basic Auth và Cookie Auth đều thất bại.');
      }
    }

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
      const catSlug = postData.slug || (finalTitle ? finalTitle.toLowerCase().replace(/đ/g, 'd').replace(/[\s_]+/g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\-]/g, "") : 'auto-cat');

      // Tạo category trước với chuỗi rỗng để chiếm chỗ và lấy ID
      wpPayload = {
        name: finalTitle || 'Chuyên mục Auto',
        description: '...',
        slug: catSlug,
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
        const catId = data.id;

        // Xử lý ảnh cho danh mục
        let imageProcessResult;
        if (postData.imageType === 'caption') {
          imageProcessResult = await processImagesByCaption(finalContent, finalTitle, siteConfig);
        } else {
          imageProcessResult = await processAndUploadImages(finalContent, thumbUrl, catSlug, postData.keyword || finalTitle, siteConfig);
        }

        // Cập nhật Description qua Admin Session để giữ lại toàn bộ HTML
        await updateCategoryDescriptionViaAdmin(catId, finalTitle, catSlug, imageProcessResult.processedHtml, siteConfig);

        await updateRankMathViaAdminSession(catId, postType, finalTitle, finalMetaDesc, postData.keyword || '', '', siteConfig)
          .catch(e => console.error('RankMath update error:', e));

        return NextResponse.json({ success: true, url: data.link, wp_id: catId });
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
        console.error("WP API trả về không phải JSON:", responseText.substring(0, 500));
        return NextResponse.json({ success: false, message: "WP trả về dữ liệu không hợp lệ." }, { status: 500 });
      }

      const postId = data.id;

      // BƯỚC 2: XỬ LÝ ẢNH & THUMBNAIL 
      // Do bài viết đã chiếm thành công slug, tên file ảnh trùng slug sẽ không ảnh hưởng bài viết nữa
      let imageProcessResult;
      if (postData.imageType === 'caption') {
        imageProcessResult = await processImagesByCaption(finalContent, finalTitle, siteConfig);
      } else {
        imageProcessResult = await processAndUploadImages(finalContent, thumbUrl, finalSlug, rawSlugText, siteConfig);
      }

      // BƯỚC 3: CẬP NHẬT LẠI BÀI VIẾT VỚI NỘI DUNG ĐÃ CÓ ẢNH & GẮN FEATURED MEDIA
      await fetch(`${endpoint}/${postId}`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          content: imageProcessResult.processedHtml,
          featured_media: imageProcessResult.thumbnailId || 0,
          meta: {
            rank_math_primary_category: postData.categoryId ? parseInt(postData.categoryId, 10) : 0
          }
        })
      });

      // Ép đè RankMath meta (await để đảm bảo hoàn thành trước khi Vercel kill function)
      await updateRankMathViaAdminSession(postId, postType, finalTitle, finalMetaDesc, postData.keyword || '', postData.categoryId || '', siteConfig)
        .catch(e => console.error('RankMath update error:', e));

      return NextResponse.json({ success: true, url: data.link, wp_id: postId });
    }

  } catch (error: any) {
    console.error('API /api/wp/post Unhandled Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
