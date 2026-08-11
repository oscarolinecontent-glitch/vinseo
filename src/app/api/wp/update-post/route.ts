import { NextResponse } from 'next/server';
import dns from 'dns';

// Fix lỗi timeout do Node.js ưu tiên IPv6 nhưng mạng 4G/NAT64 bị kẹt (bug của fetch/undici)
dns.setDefaultResultOrder('ipv4first');
import { parseGoogleDoc } from '@/lib/googleApi';
import { processAndUploadImages, processImagesByCaption } from '@/lib/imageProcessor';
import { getWpAdminSession } from '@/lib/wpAuth';
import { getWpAdminPath } from '@/lib/wpAuth';
import { makeInternalLinksRelative } from '@/lib/wpHelper';

// Tăng timeout tối đa lên 5 phút để tránh 504 khi bài có nhiều ảnh lớn
export const maxDuration = 300;

/**
 * Trích xuất Post/Page/Category ID từ URL bài viết WordPress.
 * Hỗ trợ 3 dạng:
 *  - /?p=12345 (query param)
 *  - Gọi WP REST API tìm qua slug trong posts, pages, categories
 */
async function resolvePostId(
  wpPostUrl: string,
  siteBase: string,
  headers: any
): Promise<{ id: number; type: 'post' | 'page' | 'category' } | null> {
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

    // Thử tìm trong categories
    const catRes = await fetch(`${siteBase}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}&_fields=id`, {
      headers,
    });
    if (catRes.ok) {
      const cats = await catRes.json();
      if (Array.isArray(cats) && cats.length > 0) {
        return { id: cats[0].id, type: 'category' };
      }
    }

    return null;
  } catch (e) {
    console.error('resolvePostId error:', e);
    return null;
  }
}

/**
 * Cập nhật Category Description qua giao diện wp-admin để tránh bị REST API tự động xóa thẻ HTML.
 * Trả về true nếu cập nhật thành công, false nếu thất bại.
 */
async function updateCategoryDescriptionViaAdmin(
  categoryId: number,
  title: string,
  slug: string,
  descriptionHtml: string,
  siteConfig: any
): Promise<boolean> {
  const session = await getWpAdminSession(siteConfig);
  if (!session) {
    console.warn('Update Category HTML: Không lấy được session admin.');
    return false;
  }
  
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const loginPath = siteConfig.wp_login_path || '/wp-login.php';
  const normalizedLoginPath = loginPath.startsWith('/') ? loginPath : `/${loginPath}`;
  const adminBase = getWpAdminPath(normalizedLoginPath);
  
  try {
    // 1. Fetch trang edit-tags.php để lấy form nonce
    const editUrl = `${base}${adminBase}/term.php?taxonomy=category&tag_ID=${categoryId}&post_type=post`;
    const getRes = await fetch(editUrl, {
      headers: {
        'Cookie': session.cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Connection': 'close'
      }
    });
    const html = await getRes.text();
    
    // Tìm _wpnonce cho form edit tag
    const nonceMatch = html.match(/<input type="hidden" id="_wpnonce" name="_wpnonce" value="([^"]+)"/);
    if (!nonceMatch) {
      console.warn('Update Category HTML: Không tìm thấy _wpnonce trên trang term.php.');
      return false;
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
    
    const postRes = await fetch(`${base}${adminBase}/edit-tags.php`, {
      method: 'POST',
      headers: {
        'Cookie': session.cookieStr,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Connection': 'close',
        'Referer': editUrl
      },
      body: formData.toString()
    });
    
    console.log(`Update Category HTML (${categoryId}) via Admin: Status ${postRes.status}`);
    return postRes.status === 200 || postRes.status === 302;
  } catch (e) {
    console.error('Update Category HTML Failed:', e);
    return false;
  }
}

/**
 * Cập nhật RankMath SEO meta qua Admin Session, fallback sang Basic Auth nếu session fail
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
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const rmBody = JSON.stringify({
    objectID: objectId,
    objectType: objectType === 'category' ? 'term' : 'post',
    meta: {
      rank_math_title: title,
      rank_math_description: desc,
      rank_math_focus_keyword: keyword,
      rank_math_primary_category: categoryId ? parseInt(categoryId.toString(), 10) : 0,
    },
  });

  try {
    // Cách 1: Dùng Admin Session (ưu tiên vì không bị hạn chế quyền)
    const session = await getWpAdminSession(siteConfig);
    if (session) {
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
        body: rmBody,
      });
      const rmData = await rmRes.text();
      console.log('RankMath Admin Session Update:', rmRes.status, rmData.slice(0, 200));
      return;
    }

    // Cách 2: Fallback dùng Basic Auth (App Password)

    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    const basicHeaders: any = {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${credentials}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Connection': 'close',
    };

    const rmRes = await fetch(`${base}/wp-json/rankmath/v1/updateMeta`, {
      method: 'POST',
      headers: basicHeaders,
      body: rmBody,
    });
    const rmData = await rmRes.text();
    console.log('RankMath Basic Auth Update:', rmRes.status, rmData.slice(0, 200));
  } catch (e) {
    console.error('RankMath Update Failed:', e);
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

    // BƯỚC 2: Parse Google Doc
    const parseResult = await parseGoogleDoc(postData.gdoc_url);
    if (!parseResult.success) {
      return NextResponse.json({ success: false, message: parseResult.message }, { status: 400 });
    }

    const finalTitle = parseResult.title || '';
    const finalMetaDesc = postData.meta_desc || parseResult.meta_desc || '';
    let finalContent = parseResult.content || '';
    if (postData.makeLinksRelative) {
      finalContent = makeInternalLinksRelative(finalContent, siteConfig.wp_url);
    }
    const thumbUrl = parseResult.thumb_url || '';

    // Lấy slug hiện tại từ URL
    const urlObj = new URL(postData.wp_post_url);
    const pathParts = urlObj.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const currentSlug = pathParts.length > 0 ? pathParts[pathParts.length - 1] : `post-${postId}`;
    const rawSlugText = postData.keyword || finalTitle;

    // Ưu tiên dùng keyword làm slug cho ảnh (để SEO tốt hơn)
    const imageSlug = postData.keyword 
      ? postData.keyword.toLowerCase().replace(/đ/g, 'd').replace(/[\s_]+/g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\-]/g, "") 
      : currentSlug;

    // ============ XỬ LÝ CATEGORY ============
    if (postType === 'category') {
      // BƯỚC 3: Xử lý ảnh cho category
      let imageProcessResult;
      if (postData.imageType === 'caption') {
        imageProcessResult = await processImagesByCaption(finalContent, finalTitle, siteConfig);
      } else {
        imageProcessResult = await processAndUploadImages(finalContent, thumbUrl, imageSlug, rawSlugText, siteConfig);
      }

      // BƯỚC 4: Cập nhật Category Description
      // Thử qua Admin Session trước (giữ nguyên HTML)
      const adminSuccess = await updateCategoryDescriptionViaAdmin(postId, finalTitle || currentSlug, currentSlug, imageProcessResult.processedHtml, siteConfig);
      
      let updateMethod = 'admin';
      if (!adminSuccess) {
        // Fallback: Cập nhật qua REST API (HTML có thể bị strip tùy cấu hình WP)

        const catUpdateEndpoint = `${siteBase}/wp-json/wp/v2/categories/${postId}`;
        const catPayload: any = {
          description: imageProcessResult.processedHtml,
        };
        if (finalTitle) {
          catPayload.name = finalTitle;
        }
        
        const catUpdateRes = await fetch(catUpdateEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(catPayload),
        });
        
        if (!catUpdateRes.ok) {
          const errText = await catUpdateRes.text();
          let errorMessage = `HTTP Error ${catUpdateRes.status}`;
          try {
            const err = JSON.parse(errText);
            errorMessage = err.message || errorMessage;
          } catch (e) {
            errorMessage = `Lỗi từ Server WP (Mã ${catUpdateRes.status})`;
          }
          return NextResponse.json({ success: false, message: `Lỗi cập nhật category: ${errorMessage}` }, { status: catUpdateRes.status });
        }
        

        updateMethod = 'rest-api';
      }

      // BƯỚC 5: Cập nhật RankMath SEO meta
      if (postData.keyword || finalMetaDesc) {
        await updateRankMathViaAdminSession(
          postId,
          'category',
          finalTitle,
          finalMetaDesc,
          postData.keyword || '',
          '',
          siteConfig
        ).catch(e => console.error('RankMath update error:', e));
      }

      return NextResponse.json({
        success: true,
        url: postData.wp_post_url,
        wp_id: postId,
        thumbnailUpdated: false,
        message: updateMethod === 'admin'
          ? `Đã cập nhật category #${postId} thành công (Admin Session)`
          : `Đã cập nhật category #${postId} qua REST API (lưu ý: một số thẻ HTML có thể bị WordPress tự xóa)`,
      });
    }

    // ============ XỬ LÝ POST / PAGE ============
    const endpointStr = postType === 'page' ? 'pages' : 'posts';
    const updateEndpoint = `${siteBase}/wp-json/wp/v2/${endpointStr}/${postId}`;

    // BƯỚC 3: Xử lý ảnh
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
