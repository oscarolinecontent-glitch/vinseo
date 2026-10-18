import { errorMessage } from '@/lib/types';
import { readJson, errorStatus } from '@/lib/server/request';
import { withApiAuth } from '@/lib/server/auth';
import { safeFetch as fetch } from '@/lib/server/network';
import { NextResponse } from 'next/server';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { parseGoogleDoc } from '@/lib/googleApi';
import { processAndUploadImages, processImagesByCaption } from '@/lib/imageProcessor';
import { getWpAdminSession } from '@/lib/wpAuth';
import { makeInternalLinksRelative } from '@/lib/wpHelper';
import * as cheerio from 'cheerio';
import { stripExistingImages, injectImagesIntoContent, type MediaInfo } from '@/lib/syncImages';

export const maxDuration = 300;

/**
 * Resolve Post ID từ WP URL (post hoặc page, theo slug hoặc query param)
 */
async function resolvePostId(
  wpPostUrl: string,
  siteBase: string,
  headers: Record<string, string>
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
  headers: Record<string, string>
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

export async function POST(request: Request) {
  return withApiAuth(request, async () => {
  try {
    const body = await readJson(request);
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
    let headers: Record<string, string> = {
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
      imageProcessResult = await processImagesByCaption(current.content, parseResult.title || '', siteConfig);
    } else {
      imageProcessResult = await processAndUploadImages(docsContent, thumbUrl, imageSlug, rawSlugText, siteConfig);
    }

    const uploadedImageMap = new Map(imageProcessResult.uploadedImages.map(image => [image.source, image.url]));
    const mediaInfoMap = new Map<string, MediaInfo>(imageProcessResult.uploadedImages.map(image => [image.url, image]));
    const captionMode = postData.imageType === 'caption';
    // In caption mode update matching captions in existing WP content, preserving its text.
    const injectedContent = captionMode
      ? imageProcessResult.processedHtml
      : uploadedImageMap.size
        ? injectImagesIntoContent(stripExistingImages(current.content), docsContent, uploadedImageMap, mediaInfoMap)
        : current.content;
    const imagesInjected = captionMode
      ? Math.max(0, cheerio.load(injectedContent)('img').length - cheerio.load(current.content)('img').length)
      : uploadedImageMap.size;
    if (!imagesInjected && !imageProcessResult.thumbnailId) {
      return NextResponse.json({ success: false, message: 'Không tìm thấy ảnh phù hợp. Nội dung hiện tại được giữ nguyên.' }, { status: 422 });
    }

    // BƯỚC 8: Update bài — CHỈ content và featured_media, không đổi title/excerpt/SEO
    const updatePayload: Record<string, unknown> = {
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
      imagesInjected,
      message: `Đã sync ${imagesInjected} ảnh vào bài #${postId}${thumbnailUpdated ? ' + thumbnail' : ''}`,
    });

  } catch (error) {
    console.error('API /api/wp/sync-images Unhandled Error:', error);
    return NextResponse.json({ success: false, message: errorMessage(error) }, { status: errorStatus(error) });
  }
  });
}
