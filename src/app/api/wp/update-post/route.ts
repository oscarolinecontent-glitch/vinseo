import { NextResponse } from 'next/server';
import dns from 'dns';

// Fix lỗi timeout do Node.js ưu tiên IPv6 nhưng mạng 4G/NAT64 bị kẹt (bug của fetch/undici)
dns.setDefaultResultOrder('ipv4first');
import { parseGoogleDoc } from '@/lib/googleApi';
import { processAndUploadImages, processImagesByCaption } from '@/lib/imageProcessor';
import { getWpAdminSession } from '@/lib/wpAuth';

// Tăng timeout tối đa lên 5 phút để tránh 504 khi bài có nhiều ảnh lớn
export const maxDuration = 300;

/**
 * Trích xuất Post ID từ URL bài viết WordPress.
 * Hỗ trợ 2 dạng:
 *  - /?p=12345 (query param)
 *  - Gọi WP REST API tìm qua slug (cần slug từ permalink)
 */
async function resolvePostId(
  wpPostUrl: string,
  siteBase: string,
  headers: any
): Promise<{ id: number; type: 'post' | 'page' } | null> {
  try {
    // Dạng 1: URL chứa ?p=ID hoặc ?page_id=ID
    const pMatch = wpPostUrl.match(/[?&]p=(\d+)/);
    const pageMatch = wpPostUrl.match(/[?&]page_id=(\d+)/);
    if (pMatch) return { id: parseInt(pMatch[1]), type: 'post' };
    if (pageMatch) return { id: parseInt(pageMatch[1]), type: 'page' };

    // Dạng 2: Lấy slug từ pathname và tìm qua REST API
    const urlObj = new URL(wpPostUrl);
    // Bỏ trailing slash, lấy segment cuối
    const pathParts = urlObj.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (pathParts.length === 0) return null;
    const slug = pathParts[pathParts.length - 1];

    // Thử tìm trong posts trước
    const postRes = await fetch(`${siteBase}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id,type`, {
      headers,
    });
    if (postRes.ok) {
      const posts = await postRes.json();
      if (Array.isArray(posts) && posts.length > 0) {
        return { id: posts[0].id, type: 'post' };
      }
    }

    // Thử tìm trong pages
    const pageRes = await fetch(`${siteBase}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&_fields=id,type`, {
      headers,
    });
    if (pageRes.ok) {
      const pages = await pageRes.json();
      if (Array.isArray(pages) && pages.length > 0) {
        return { id: pages[0].id, type: 'page' };
      }
    }

    return null;
  } catch (e) {
    console.error('resolvePostId error:', e);
    return null;
  }
}

/**
 * Cập nhật RankMath SEO meta qua Admin Session
 */
async function updateRankMathViaAdminSession(
  objectId: number,
  objectType: string,
  title: string,
  desc: string,
  keyword: string,
  categoryId: string | number,
  siteConfig: any
) {
  try {
    const session = await getWpAdminSession(siteConfig);
    if (!session) {
      console.warn('RankMath Update: Không lấy được session admin.');
      return;
    }

    const base = siteConfig.wp_url.replace(/\/$/, '');
    const rmHeaders: any = {
      'Content-Type': 'application/json',
      'Cookie': session.cookieStr,
      'X-WP-Nonce': session.nonce,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Connection': 'close',
    };

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
          rank_math_primary_category: categoryId ? parseInt(categoryId.toString(), 10) : 0,
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

    // postData cần: gdoc_url, wp_post_url, keyword?, meta_desc?, imageType?

    if (!siteConfig || !siteConfig.wp_url || !siteConfig.wp_user || !siteConfig.wp_app_pass) {
      return NextResponse.json({ success: false, message: 'Thiếu thông tin kết nối (siteConfig)' }, { status: 400 });
    }
    if (!postData?.gdoc_url) {
      return NextResponse.json({ success: false, message: 'Thiếu link Google Docs' }, { status: 400 });
    }
    if (!postData?.wp_post_url) {
      return NextResponse.json({ success: false, message: 'Thiếu link bài viết WordPress cần cập nhật' }, { status: 400 });
    }

    let urlToUse = siteConfig.wp_url.trim();
    if (!urlToUse.startsWith('http://') && !urlToUse.startsWith('https://')) {
      urlToUse = 'https://' + urlToUse;
    }
    siteConfig.wp_url = urlToUse;

    if (siteConfig.image_width) siteConfig.image_width = parseInt(siteConfig.image_width, 10) || undefined;
    if (siteConfig.image_height) siteConfig.image_height = parseInt(siteConfig.image_height, 10) || undefined;

    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    let headers: any = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Connection': 'close',
    };

    // Kiểm tra xem Basic Auth có bị Firewall chặn không
    const siteBase = urlToUse.replace(/\/$/, '');
    const checkEndpoint = `${siteBase}/wp-json/wp/v2/users/me`;
    const checkRes = await fetch(checkEndpoint, { method: 'GET', headers });
    if (!checkRes.ok) {
      console.log('WP UPDATE POST: Basic Auth failed, trying Cookie fallback...');
      const session = await getWpAdminSession(siteConfig);
      if (session) {
        headers = {
          'Cookie': session.cookieStr,
          'X-WP-Nonce': session.nonce,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Connection': 'close',
        };
        siteConfig.authHeaders = {
          'Cookie': session.cookieStr,
          'X-WP-Nonce': session.nonce,
        };
      } else {
        console.error('WP UPDATE POST: Cả Basic Auth và Cookie Auth đều thất bại.');
      }
    }

    // BƯỚC 1: Resolve Post ID từ WP URL
    const resolved = await resolvePostId(postData.wp_post_url, siteBase, headers);
    if (!resolved) {
      return NextResponse.json({
        success: false,
        errorCode: 'URL_NOT_FOUND',
        message: `Không tìm thấy bài viết trên WordPress với URL này. Kiểm tra lại URL hoặc Site Config.`,
      }, { status: 404 });
    }

    const { id: postId, type: postType } = resolved;
    const endpointStr = postType === 'page' ? 'pages' : 'posts';
    const updateEndpoint = `${siteBase}/wp-json/wp/v2/${endpointStr}/${postId}`;

    // BƯỚC 2: Parse Google Doc
    const parseResult = await parseGoogleDoc(postData.gdoc_url);
    if (!parseResult.success) {
      return NextResponse.json({ success: false, message: parseResult.message }, { status: 400 });
    }

    const finalTitle = parseResult.title || '';
    const finalMetaDesc = postData.meta_desc || parseResult.meta_desc || '';
    const finalContent = parseResult.content || '';
    const thumbUrl = parseResult.thumb_url || '';

    // BƯỚC 3: Xử lý ảnh
    // Lấy slug hiện tại của bài để đặt tên file ảnh tương ứng (nếu không có keyword)
    const urlObj = new URL(postData.wp_post_url);
    const pathParts = urlObj.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const currentSlug = pathParts.length > 0 ? pathParts[pathParts.length - 1] : `post-${postId}`;
    const rawSlugText = postData.keyword || finalTitle;
    
    // Ưu tiên dùng keyword làm slug cho ảnh (để SEO tốt hơn)
    const imageSlug = postData.keyword 
      ? postData.keyword.toLowerCase().replace(/đ/g, 'd').replace(/[\s_]+/g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\-]/g, "") 
      : currentSlug;

    let imageProcessResult;
    if (postData.imageType === 'caption') {
      imageProcessResult = await processImagesByCaption(finalContent, finalTitle, siteConfig);
    } else {
      imageProcessResult = await processAndUploadImages(finalContent, thumbUrl, imageSlug, rawSlugText, siteConfig);
    }

    // BƯỚC 4: Cập nhật bài viết qua WP REST API (POST lên /{id})
    const updatePayload: any = {
      content: imageProcessResult.processedHtml,
    };

    // Chỉ cập nhật featured_media nếu có thumbnail mới
    if (imageProcessResult.thumbnailId) {
      updatePayload.featured_media = imageProcessResult.thumbnailId;
    }

    // Chỉ cập nhật title nếu doc có title
    if (finalTitle) {
      updatePayload.title = finalTitle;
    }

    // Chỉ cập nhật excerpt nếu có meta_desc
    if (finalMetaDesc && postType === 'post') {
      updatePayload.excerpt = finalMetaDesc;
    }

    const updateRes = await fetch(updateEndpoint, {
      method: 'POST', // WP REST API dùng POST (không phải PUT) để update
      headers,
      body: JSON.stringify(updatePayload),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      let errorMessage = `HTTP Error ${updateRes.status}`;
      try {
        const err = JSON.parse(errText);
        errorMessage = err.message || errorMessage;
      } catch (e) {
        errorMessage = `Lỗi từ Server WP (Mã ${updateRes.status}). Máy chủ trả về HTML thay vì JSON.`;
      }
      return NextResponse.json({ success: false, message: errorMessage }, { status: updateRes.status });
    }

    const updatedData = await updateRes.json();

    // BƯỚC 5: Cập nhật RankMath SEO meta (nếu có keyword hoặc meta_desc)
    if (postData.keyword || finalMetaDesc) {
      await updateRankMathViaAdminSession(
        postId,
        postType,
        finalTitle,
        finalMetaDesc,
        postData.keyword || '',
        '',
        siteConfig
      ).catch(e => console.error('RankMath update error:', e));
    }

    const thumbnailUpdated = !!(imageProcessResult.thumbnailId);

    return NextResponse.json({
      success: true,
      url: updatedData.link || postData.wp_post_url,
      wp_id: postId,
      thumbnailUpdated,
      message: thumbnailUpdated
        ? `Đã cập nhật bài viết #${postId} thành công (có thumbnail)`
        : `Đã cập nhật bài viết #${postId} thành công (không tìm thấy thumbnail trong Docs — vui lòng thêm thủ công)`,
    });

  } catch (error: any) {
    console.error('API /api/wp/update-post Unhandled Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
