import { NextResponse } from 'next/server';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { parseGoogleDoc } from '@/lib/googleApi';
import { processAndUploadImages, processImagesByCaption } from '@/lib/imageProcessor';
import { getWpAdminSession } from '@/lib/wpAuth';
import { makeInternalLinksRelative } from '@/lib/wpHelper';
import * as cheerio from 'cheerio';

export const maxDuration = 300;

/**
 * Resolve Post ID từ WP URL (post hoặc page, theo slug hoặc query param)
 */
async function resolvePostId(
  wpPostUrl: string,
  siteBase: string,
  headers: any
): Promise<{ id: number; type: 'post' | 'page' } | null> {
  try {
    const pMatch = wpPostUrl.match(/[?&]p=(\d+)/);
    const pageMatch = wpPostUrl.match(/[?&]page_id=(\d+)/);
    if (pMatch) return { id: parseInt(pMatch[1]), type: 'post' };
    if (pageMatch) return { id: parseInt(pageMatch[1]), type: 'page' };

    const urlObj = new URL(wpPostUrl);
    const pathParts = urlObj.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (pathParts.length === 0) return null;
    const slug = pathParts[pathParts.length - 1];

    const postRes = await fetch(`${siteBase}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id,type`, { headers });
    if (postRes.ok) {
      const posts = await postRes.json();
      if (Array.isArray(posts) && posts.length > 0) return { id: posts[0].id, type: 'post' };
    }

    const pageRes = await fetch(`${siteBase}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&_fields=id,type`, { headers });
    if (pageRes.ok) {
      const pages = await pageRes.json();
      if (Array.isArray(pages) && pages.length > 0) return { id: pages[0].id, type: 'page' };
    }

    return null;
  } catch (e) {
    console.error('resolvePostId error:', e);
    return null;
  }
}

/**
 * Lấy content hiện tại của bài viết từ WP REST API
 * Trả về raw HTML content đang có trên WP
 */
async function getCurrentPostContent(
  postId: number,
  postType: 'post' | 'page',
  siteBase: string,
  headers: any
): Promise<{ content: string; featuredMediaId: number } | null> {
  try {
    const endpointStr = postType === 'page' ? 'pages' : 'posts';
    // context=edit bắt buộc để WP trả về content.raw
    const res = await fetch(`${siteBase}/wp-json/wp/v2/${endpointStr}/${postId}?context=edit&_fields=content,featured_media`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      content: data.content?.raw || data.content?.rendered || '',
      featuredMediaId: data.featured_media || 0,
    };
  } catch (e) {
    console.error('getCurrentPostContent error:', e);
    return null;
  }
}

type MediaInfo = { id: number; width?: number; height?: number };

/**
 * Xóa tất cả ảnh hiện có trong WP content trước khi re-inject.
 * Hỗ trợ cả Gutenberg <figure> và Classic [caption] shortcode.
 * Mục đích: đảm bảo mỗi lần sync luôn chạy lại từ đầu đúng vị trí và đúng format.
 */
function stripExistingImages(rawContent: string): string {
  // 1. Xóa [caption]...[/caption] shortcodes (Classic Editor)
  let stripped = rawContent.replace(/\[caption[^\]]*\][\s\S]*?\[\/caption\]/gi, '');

  // 2. Dùng cheerio xóa các block HTML chứa ảnh
  const $ = cheerio.load(stripped, { xmlMode: false });

  // Xóa tất cả <figure> (Gutenberg wp-block-image)
  $('figure').remove();

  // Xóa <p> chỉ chứa img (không có text)
  $('p').each((_, el) => {
    const $el = $(el);
    if ($el.find('img').length > 0 && $el.text().trim() === '') {
      $el.remove();
    }
  });

  // Xóa img còn sót
  $('img').remove();

  // Xóa <p> caption-like (căn giữa/italic ngắn) được publish cùng bài gốc
  // Mục đích: không làm lệch pointer wpIdx khi inject
  $('p').each((_, el) => {
    const $el = $(el);
    const style = ($el.attr('style') || '').toLowerCase();
    const text = $el.text().trim();
    const allInline = $el.children().length > 0 && $el.children().toArray().every((c: any) =>
      ['i', 'em', 'b', 'strong', 'span', 'a', 'u'].includes(c.tagName?.toLowerCase())
    );
    const isEmpty = text.length === 0;
    const isCaption = text.length > 0 && text.length < 200 &&
      (style.includes('center') || (allInline && $el.find('i, em').length > 0));
    if (isEmpty || isCaption) $el.remove();
  });

  return $('body').html() || stripped;
}

/**
 * Inject ảnh đã upload vào content hiện tại của WP.
 *
 * Case A - WP đã có <img>: thay src cũ → src WP mới theo thứ tự.
 * Case B - WP chưa có <img>: phân tích Docs HTML, detect chú thích ở sibling,
 *          output [caption] shortcode đúng cẩu Classic Editor.
 */
function injectImagesIntoContent(
  wpContent: string,
  docsContent: string,
  uploadedImageMap: Map<string, string>,      // oldGoogleSrc → newWpUrl
  mediaInfoMap: Map<string, MediaInfo>        // newWpUrl → { id, width, height }
): string {
  const $wp = cheerio.load(wpContent, { xmlMode: false });
  const $docs = cheerio.load(docsContent, { xmlMode: false });

  // Helper: tạo block HTML đúng format WP
  const makeBlock = (newSrc: string, captionText: string): string => {
    const info = mediaInfoMap.get(newSrc);
    if (info?.id) {
      // Classic Editor [caption] shortcode format
      const w = info.width || 800;
      const hAttr = info.height ? ` height="${info.height}"` : '';
      const capPart = captionText ? ` ${captionText}` : '';
      return `[caption id="attachment_${info.id}" align="aligncenter" width="${w}"]` +
             `<img class="size-full wp-image-${info.id}" src="${newSrc}" alt="${captionText}" width="${w}"${hAttr} />` +
             `${capPart}[/caption]`;
    }
    // Fallback: Gutenberg block
    const capHtml = captionText ? `<figcaption class="wp-element-caption">${captionText}</figcaption>` : '';
    return `<figure class="wp-block-image size-full"><img src="${newSrc}" alt="${captionText}" />${capHtml}</figure>`;
  };

  const wpImgs = $wp('img').toArray();

  // ── CASE A: WP đã có ảnh → thay src theo thứ tự ──
  if (wpImgs.length > 0) {
    const newSrcs = [...uploadedImageMap.values()];
    wpImgs.forEach((el, idx) => {
      if (newSrcs[idx]) {
        $wp(el).attr('src', newSrcs[idx]);
        $wp(el).removeAttr('srcset');
      }
    });
    return $wp('body').html() || wpContent;
  }

  // ── CASE B: WP chưa có ảnh → chèn theo vị trí từ Docs ──
  // Dùng pure string assembly thay vì cheerio DOM write
  // để [caption] shortcodes không bị parser HTML của cheerio mangle.

  const wpChildren = $wp('body').children().toArray();
  const docsTopChildren = $docs('body').children().toArray();

  // Xác định vị trí chèn: afterIdx là index trong wpChildren (−1 = trước tất cả)
  const insertions: { afterIdx: number; block: string }[] = [];
  let wpIdx = 0;

  for (let i = 0; i < docsTopChildren.length; i++) {
    const docsEl = docsTopChildren[i];
    const $docsEl = $docs(docsEl);
    const tag = (docsEl as any).tagName?.toLowerCase() || '';

    let imgSrc: string | null = null;
    let captionText = '';

    if (tag === 'img') {
      imgSrc = $docsEl.attr('src') || null;
      captionText = $docsEl.attr('data-temp-caption') || '';
    } else {
      const inner = $docsEl.find('img').first();
      if (inner.length > 0) {
        imgSrc = inner.attr('src') || null;
        captionText = inner.attr('data-temp-caption') || '';
      }
    }

    if (imgSrc) {
      if (uploadedImageMap.has(imgSrc)) {
        const newSrc = uploadedImageMap.get(imgSrc)!;
        insertions.push({ afterIdx: wpIdx - 1, block: makeBlock(newSrc, captionText) });
      } else {
        // Ảnh không upload được → skip
      }
      // KHÔNG tăng wpIdx vì ảnh sẽ thay thế element này
    } else {
      wpIdx++;
    }
  }

  // Nhóm các block theo afterIdx
  const insertionMap = new Map<number, string[]>();
  for (const { afterIdx, block } of insertions) {
    if (!insertionMap.has(afterIdx)) insertionMap.set(afterIdx, []);
    insertionMap.get(afterIdx)!.push(block);
  }

  // Assembly thuần string: lấy outerHTML từng WP block + xen ảnh vào đúng chỗ
  const parts: string[] = [...(insertionMap.get(-1) || [])]; // ảnh trước tất cả block
  for (let i = 0; i < wpChildren.length; i++) {
    const outerHtml = $wp.html($wp(wpChildren[i]));
    if (outerHtml) parts.push(outerHtml);
    for (const block of (insertionMap.get(i) || [])) {
      parts.push(block);
    }
  }

  return parts.join('\n');
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { siteConfig, postData } = body;

    if (!siteConfig?.wp_url || !siteConfig?.wp_user || !siteConfig?.wp_app_pass) {
      return NextResponse.json({ success: false, message: 'Thiếu thông tin kết nối (siteConfig)' }, { status: 400 });
    }
    if (!postData?.gdoc_url) {
      return NextResponse.json({ success: false, message: 'Thiếu link Google Docs' }, { status: 400 });
    }
    if (!postData?.wp_post_url) {
      return NextResponse.json({ success: false, message: 'Thiếu link bài viết WordPress' }, { status: 400 });
    }

    let urlToUse = siteConfig.wp_url.trim();
    if (!urlToUse.startsWith('http://') && !urlToUse.startsWith('https://')) {
      urlToUse = 'https://' + urlToUse;
    }
    siteConfig.wp_url = urlToUse;
    const siteBase = urlToUse.replace(/\/$/, '');

    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    let headers: any = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Connection': 'close',
    };

    // Fallback Cookie Auth nếu Basic Auth bị chặn
    const checkRes = await fetch(`${siteBase}/wp-json/wp/v2/users/me`, { method: 'GET', headers });
    if (!checkRes.ok) {
      const session = await getWpAdminSession(siteConfig);
      if (session) {
        headers = {
          'Cookie': session.cookieStr,
          'X-WP-Nonce': session.nonce,
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Connection': 'close',
        };
        siteConfig.authHeaders = { 'Cookie': session.cookieStr, 'X-WP-Nonce': session.nonce };
      }
    }

    // BƯỚC 1: Resolve Post ID
    const resolved = await resolvePostId(postData.wp_post_url, siteBase, headers);
    if (!resolved) {
      return NextResponse.json({
        success: false,
        errorCode: 'URL_NOT_FOUND',
        message: 'Không tìm thấy bài viết trên WordPress với URL này. Kiểm tra lại URL hoặc Site Config.',
      }, { status: 404 });
    }

    const { id: postId, type: postType } = resolved;
    const endpointStr = postType === 'page' ? 'pages' : 'posts';
    const updateEndpoint = `${siteBase}/wp-json/wp/v2/${endpointStr}/${postId}`;

    // BƯỚC 2: Lấy content hiện tại của bài WP
    const current = await getCurrentPostContent(postId, postType, siteBase, headers);
    if (!current) {
      return NextResponse.json({ success: false, message: `Không thể đọc content bài #${postId} từ WordPress.` }, { status: 500 });
    }

    // BƯỚC 3: Parse Google Doc → lấy ảnh
    const parseResult = await parseGoogleDoc(postData.gdoc_url);
    if (!parseResult.success) {
      return NextResponse.json({ success: false, message: parseResult.message }, { status: 400 });
    }

    let docsContent = parseResult.content || '';
    if (postData.makeLinksRelative) {
      docsContent = makeInternalLinksRelative(docsContent, siteConfig.wp_url);
    }
    const thumbUrl = parseResult.thumb_url || '';

    if (!docsContent && !thumbUrl) {
      return NextResponse.json({ success: false, message: 'Google Docs không có ảnh nào để sync.' }, { status: 400 });
    }

    // BƯỚC 4: Upload ảnh lên WP Media (giữ format + không resize)
    const urlObj = new URL(postData.wp_post_url);
    const pathParts = urlObj.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    const currentSlug = pathParts.length > 0 ? pathParts[pathParts.length - 1] : `post-${postId}`;
    const rawSlugText = postData.keyword || parseResult.title || currentSlug;

    // Ưu tiên dùng keyword làm slug cho ảnh (để SEO tốt hơn)
    const imageSlug = postData.keyword 
      ? postData.keyword.toLowerCase().replace(/đ/g, 'd').replace(/[\s_]+/g, '-').normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\-]/g, "") 
      : currentSlug;

    let imageProcessResult;
    if (postData.imageType === 'caption') {
      imageProcessResult = await processImagesByCaption(docsContent, parseResult.title || '', siteConfig);
    } else {
      imageProcessResult = await processAndUploadImages(docsContent, thumbUrl, imageSlug, rawSlugText, siteConfig);
    }

    // BƯỚC 5: Build map oldSrc → newWpUrl từ processed HTML
    const $processed = cheerio.load(imageProcessResult.processedHtml, { xmlMode: false });
    const $docs = cheerio.load(docsContent, { xmlMode: false });

    const docsOriginalSrcs: string[] = [];
    $docs('img').each((_, el) => {
      const src = $docs(el).attr('src');
      if (src) docsOriginalSrcs.push(src);
    });

    const processedSrcs: string[] = [];
    $processed('img').each((_, el) => {
      const src = $processed(el).attr('src');
      if (src) processedSrcs.push(src);
    });

    const uploadedImageMap = new Map<string, string>();
    docsOriginalSrcs.forEach((origSrc, idx) => {
      if (processedSrcs[idx]) {
        // Chỉ map nếu src mới khác src cũ (tức là đã upload thành công lên WP)
        const isGoogleSrc = origSrc.includes('googleusercontent.com') || origSrc.includes('drive.google.com') || origSrc.includes('docs.google.com');
        const isNewWpSrc = !processedSrcs[idx].includes('googleusercontent.com') && !processedSrcs[idx].includes('drive.google.com');
        if (isNewWpSrc || !isGoogleSrc) {
          uploadedImageMap.set(origSrc, processedSrcs[idx]);
        }
      }
    });

    // Nếu Docs có ảnh nhưng không upload được cái nào → báo lỗi rõ ràng
    if (docsOriginalSrcs.length > 0 && uploadedImageMap.size === 0) {
      return NextResponse.json({
        success: false,
        errorCode: 'UPLOAD_FAILED',
        message: `Docs có ${docsOriginalSrcs.length} ảnh nhưng không upload được lên WP. Có thể do URL ảnh Google đã hết hạn hoặc bị chặn. Thử mở Docs, xóa và chèn lại ảnh rồi sync lại.`,
      }, { status: 422 });
    }

    // BƯỚC 6: Fetch media info (id, width, height) cho mỗi ảnh đã upload
    const mediaInfoMap = new Map<string, MediaInfo>();
    await Promise.all([...uploadedImageMap.values()].map(async (wpUrl) => {
      try {
        const filename = wpUrl.split('/').pop() || '';
        const slug = filename.replace(/\.[^.]+$/, ''); // bỏ extension
        const res = await fetch(
          `${siteBase}/wp-json/wp/v2/media?slug=${encodeURIComponent(slug)}&_fields=id,source_url,media_details`,
          { headers }
        );
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            mediaInfoMap.set(wpUrl, {
              id: data[0].id,
              width: data[0].media_details?.width,
              height: data[0].media_details?.height,
            });
          }
        }
      } catch {}
    }));

    // BƯỚC 7: Strip ảnh cũ (nếu có từ lần sync trước) rồi inject lại từ đầu
    const strippedContent = stripExistingImages(current.content);
    const injectedContent = injectImagesIntoContent(
      strippedContent,
      docsContent,
      uploadedImageMap,
      mediaInfoMap
    );

    // BƯỚC 8: Update bài — CHỈ content và featured_media, không đổi title/excerpt/SEO
    const updatePayload: any = {
      content: injectedContent,
    };

    const thumbnailUpdated = !!(imageProcessResult.thumbnailId);
    if (thumbnailUpdated) {
      updatePayload.featured_media = imageProcessResult.thumbnailId;
    }

    const updateRes = await fetch(updateEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(updatePayload),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      let errorMessage = `HTTP Error ${updateRes.status}`;
      try {
        const err = JSON.parse(errText);
        errorMessage = err.message || errorMessage;
      } catch {
        errorMessage = `Lỗi từ Server WP (Mã ${updateRes.status})`;
      }
      return NextResponse.json({ success: false, message: errorMessage }, { status: updateRes.status });
    }

    const updatedData = await updateRes.json();

    return NextResponse.json({
      success: true,
      url: updatedData.link || postData.wp_post_url,
      wp_id: postId,
      postType,
      thumbnailUpdated,
      imagesInjected: uploadedImageMap.size,
      message: `Đã sync ${uploadedImageMap.size} ảnh vào bài #${postId}${thumbnailUpdated ? ' + thumbnail' : ''}`,
    });

  } catch (error: any) {
    console.error('API /api/wp/sync-images Unhandled Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
