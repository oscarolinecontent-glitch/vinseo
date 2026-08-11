import { NextResponse } from 'next/server';
import dns from 'dns';
import sharp from 'sharp';
import * as cheerio from 'cheerio';

dns.setDefaultResultOrder('ipv4first');
import { getWpAdminSession } from '@/lib/wpAuth';

export const maxDuration = 300;

interface SiteConfig {
  wp_url: string;
  wp_user: string;
  wp_app_pass: string;
  wp_password?: string;
  wp_login_path?: string;
  image_format?: string;
  authHeaders?: any;
}

function getApiHeaders(siteConfig: SiteConfig, additionalHeaders: any = {}) {
  const headers = siteConfig.authHeaders ? { ...siteConfig.authHeaders } : {
    'Authorization': 'Basic ' + Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64')
  };
  return { ...headers, ...additionalHeaders, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Connection': 'close' };
}

/**
 * Lấy Post ID từ URL bài viết
 */
async function getPostIdFromUrl(postUrl: string, siteConfig: SiteConfig): Promise<{ id: number, type: string } | null> {
  try {
    // Đảm bảo URL có protocol
    let normalizedUrl = postUrl.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    const urlObj = new URL(normalizedUrl);
    let slug = urlObj.pathname.replace(/\/$/, '').split('/').pop() || '';
    // Xoá .html, .htm nếu có
    slug = slug.replace(/\.(html?|php)$/i, '');
    
    if (!slug) {
      return null;
    }

    if (urlObj.pathname.includes('/category/')) {
      const catBase = siteConfig.wp_url?.replace(/\/$/, '') || `https://${urlObj.hostname}`;
      const catRes = await fetch(`${catBase}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}&_fields=id`, {
        headers: { 'Authorization': 'Basic ' + Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64') }
      });
      if (catRes.ok) {
        const catData = await catRes.json();
        if (catData.length > 0) return { id: catData[0].id, type: 'category' };
      }
      return null;
    }

    const base = siteConfig.wp_url.replace(/\/$/, '');
    
    // Chỉ tìm trong posts và pages
    const endpoints = [
      { type: 'post', url: `${base}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id,type,slug,status` },
      { type: 'page', url: `${base}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&_fields=id,type,slug,status` }
    ];

    for (const endpoint of endpoints) {
      const res = await fetch(endpoint.url, {
        headers: getApiHeaders(siteConfig)
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.length > 0) {
          return { id: data[0].id, type: endpoint.type };
        }
      } else { await res.text().catch(() => ''); }
    }

    const searchKeyword = slug.replace(/-/g, ' ');
    const fallbackRes = await fetch(`${base}/wp-json/wp/v2/posts?search=${encodeURIComponent(searchKeyword)}&per_page=10&_fields=id,slug,type,link`, {
      headers: getApiHeaders(siteConfig)
    });
    if (fallbackRes.ok) {
      const fallbackData = await fallbackRes.json();

      // Exact match trước
      const exactMatch = fallbackData.find((p: any) => p.slug === slug);
      if (exactMatch) {
        return { id: exactMatch.id, type: 'post' };
      }
      
      // Link chứa slug
      const linkMatch = fallbackData.find((p: any) => p.link?.includes(slug));
      if (linkMatch) {
        return { id: linkMatch.id, type: 'post' };
      }

      // Slug bắt đầu bằng input slug (trường hợp user nhập URL rút gọn)
      const partialMatch = fallbackData.find((p: any) => p.slug?.startsWith(slug));
      if (partialMatch) {
        return { id: partialMatch.id, type: 'post' };
      }
    }

    // Fallback 2: Thử tìm trong categories
    const catFallbackRes = await fetch(`${base}/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}&_fields=id`, {
      headers: getApiHeaders(siteConfig)
    });
    if (catFallbackRes.ok) {
      const catData = await catFallbackRes.json();
      if (catData.length > 0) {
        return { id: catData[0].id, type: 'category' };
      }
    }

    return null;
  } catch (e: any) {
    console.error('[Resize] Lỗi getPostIdFromUrl:', e.message);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { siteConfig, postUrls, targetWidth, targetHeight, imageFormat, deleteOldMedia } = body;

    if (!siteConfig?.wp_url || !siteConfig?.wp_user || !siteConfig?.wp_app_pass) {
      return NextResponse.json({ success: false, message: 'Thiếu thông tin kết nối WordPress.' }, { status: 400 });
    }
    if (!targetWidth || !targetHeight) {
      return NextResponse.json({ success: false, message: 'Thiếu kích thước đích (width/height).' }, { status: 400 });
    }
    if (!postUrls || !Array.isArray(postUrls) || postUrls.length === 0) {
      return NextResponse.json({ success: false, message: 'Thiếu danh sách URL bài viết.' }, { status: 400 });
    }

    // Normalize URL
    let urlToUse = siteConfig.wp_url.trim();
    if (!urlToUse.startsWith('http://') && !urlToUse.startsWith('https://')) {
      urlToUse = 'https://' + urlToUse;
    }
    siteConfig.wp_url = urlToUse;

    // Auth check
    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    const headers: any = {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Connection': 'close'
    };

    const checkRes = await fetch(`${urlToUse.replace(/\/$/, '')}/wp-json/wp/v2/users/me`, { method: 'GET', headers });
    if (!checkRes.ok) {
      const session = await getWpAdminSession(siteConfig);
      if (session) {
        siteConfig.authHeaders = { 'Cookie': session.cookieStr, 'X-WP-Nonce': session.nonce };
      }
    }

    const tw = parseInt(targetWidth, 10);
    const th = parseInt(targetHeight, 10);
    const format = imageFormat || 'webp';

    const base = siteConfig.wp_url.replace(/\/$/, '');

    const results: Array<{
      postUrl: string;
      status: 'success' | 'error';
      message: string;
      resizedCount?: number;
    }> = [];

    for (const postUrl of postUrls) {
      const trimmedUrl = postUrl.trim();
      if (!trimmedUrl) continue;

      try {
        // 1. Lấy Post ID
        const postInfo = await getPostIdFromUrl(trimmedUrl, siteConfig);
        if (!postInfo) {
          results.push({ postUrl: trimmedUrl, status: 'error', message: 'Không tìm thấy bài viết.' });
          continue;
        }

        const isCategory = postInfo.type === 'category';
        const endpoint = isCategory ? 'categories' : (postInfo.type === 'page' ? 'pages' : 'posts');

        // 2. Lấy nội dung bài viết / category (CẦN context=edit ĐỂ LẤY CONTENT.RAW CHỨA GUTENBERG BLOCKS)
        const contentFields = isCategory ? '_fields=description' : '_fields=content,featured_media';
        const postRes = await fetch(`${base}/wp-json/wp/v2/${endpoint}/${postInfo.id}?context=edit&${contentFields}`, {
          headers: getApiHeaders(siteConfig)
        });
        if (!postRes.ok) {
          results.push({ postUrl: trimmedUrl, status: 'error', message: `Không lấy được nội dung (HTTP ${postRes.status}).` });
          continue;
        }
        const postData = await postRes.json();
        // Post/Page dùng 'content.raw' (mã gốc) thay vì 'rendered' (đã biên dịch)
        const content = isCategory ? (postData.description || '') : (postData.content?.raw || postData.content?.rendered || '');
        const featuredMediaId = isCategory ? 0 : (postData.featured_media || 0);

        // 3. Tìm tất cả media IDs trong nội dung
        const mediaIdMatches = content.match(/wp-image-(\d+)/g) || [];
        const uniqueMediaIds: number[] = Array.from(new Set(mediaIdMatches.map((m: string) => parseInt(m.replace('wp-image-', '')))));
        

        if (uniqueMediaIds.length === 0) {
          if (content.includes('<img')) {
            
            const $parse = cheerio.load(content, { xmlMode: false });
            const imgSrcs: string[] = [];
            $parse('img').each((_, el) => {
              const src = $parse(el).attr('src');
              if (src && !imgSrcs.includes(src)) imgSrcs.push(src);
            });

            let updatedContent: string = content || '';
            let srcResizedCount = 0;
            
            for (const imgSrc of imgSrcs) {
              try {
                // Download ảnh
                const imgRes = await fetch(imgSrc, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (!imgRes.ok) continue;
                const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

                // Resize
                let pipeline = sharp(imgBuffer).resize(tw, th, { fit: 'cover', position: 'center' });
                let contentType: string;
                let ext: string;
                if (format === 'jpeg' || format === 'jpg') {
                  pipeline = pipeline.jpeg({ quality: 80 }); contentType = 'image/jpeg'; ext = 'jpg';
                } else if (format === 'png') {
                  pipeline = pipeline.png({ quality: 80 }); contentType = 'image/png'; ext = 'png';
                } else {
                  pipeline = pipeline.webp({ quality: 80 }); contentType = 'image/webp'; ext = 'webp';
                }
                const resizedBuffer = await pipeline.toBuffer();

                // Lấy filename từ URL gốc
                const origName = imgSrc.split('/').pop()?.split('?')[0] || `image-src-${srcResizedCount}`;
                const newFilename = origName.replace(/\.[^.]+$/, `.${ext}`).replace(/[^a-zA-Z0-9.\-]/g, '');

                // Upload ảnh mới
                const uploadRes = await fetch(`${base}/wp-json/wp/v2/media`, {
                  method: 'POST',
                  headers: getApiHeaders(siteConfig, {
                    'Content-Type': contentType,
                    'Content-Disposition': `attachment; filename="${newFilename}"`
                  }),
                  body: resizedBuffer as any
                });
                if (!uploadRes.ok) continue;
                const newMedia = await uploadRes.json();

                // Cập nhật src trong HTML bằng string replace an toàn
                const escapedSrc = imgSrc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                updatedContent = updatedContent.replace(new RegExp(escapedSrc, 'g'), newMedia.source_url);

                // Update width và height trên thẻ img chứa url mới
                updatedContent = updatedContent.replace(/<img[^>]+>/g, (imgTag: string) => {
                  if (imgTag.includes(newMedia.source_url)) {
                    if (imgTag.includes('width=')) imgTag = imgTag.replace(/width="[^"]*"/, `width="${tw}"`);
                    if (imgTag.includes('height=')) imgTag = imgTag.replace(/height="[^"]*"/, `height="${th}"`);
                    imgTag = imgTag.replace(/srcset="[^"]*"/, `srcset=""`); // xoá srcset để ko load ảnh cũ
                    return imgTag;
                  }
                  return imgTag;
                });

                srcResizedCount++;
                await new Promise(r => setTimeout(r, 500));
              } catch (imgErr) {
                console.error('[Resize] Lỗi xử lý ảnh src:', imgErr);
              }
            }

            if (srcResizedCount > 0) {
              const updateBody: any = isCategory
                ? { description: updatedContent }
                : { content: updatedContent };
              
              await fetch(`${base}/wp-json/wp/v2/${endpoint}/${postInfo.id}`, {
                method: 'POST',
                headers: getApiHeaders(siteConfig, { 'Content-Type': 'application/json' }),
                body: JSON.stringify(updateBody)
              });
            }

            results.push({
              postUrl: trimmedUrl,
              status: srcResizedCount > 0 ? 'success' : 'error',
              message: srcResizedCount > 0 ? `Resize thành công ${srcResizedCount} ảnh (src mode) → ${tw}x${th}.` : 'Không resize được ảnh nào.',
              resizedCount: srcResizedCount
            });
            continue; // Đã xử lý xong, chuyển bài tiếp
          } else {
            results.push({ postUrl: trimmedUrl, status: 'error', message: 'Không tìm thấy ảnh nào trong nội dung.' });
            continue;
          }
        }

        let resizedCount = 0;
        const idMapping: Record<number, { newId: number, newUrl: string, newWidth: number, newHeight: number }> = {};
        const mediaToDelete: number[] = [];

        for (const mediaId of uniqueMediaIds) {
          try {
            const mediaRes = await fetch(`${base}/wp-json/wp/v2/media/${mediaId}?context=edit&_fields=id,source_url,alt_text,title,caption,description,slug`, {
              headers: getApiHeaders(siteConfig)
            });
            if (!mediaRes.ok) continue;
            const mediaData = await mediaRes.json();

            const sourceUrl = mediaData.source_url;
            if (!sourceUrl) continue;

            // Download ảnh gốc từ WP
            const imgRes = await fetch(sourceUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (!imgRes.ok) continue;
            const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

            let pipeline = sharp(imgBuffer).resize(tw, th, { fit: 'cover', position: 'center' });

            let contentType: string;
            let ext: string;
            if (format === 'jpeg' || format === 'jpg') {
              pipeline = pipeline.jpeg({ quality: 80 });
              contentType = 'image/jpeg';
              ext = 'jpg';
            } else if (format === 'png') {
              pipeline = pipeline.png({ quality: 80 });
              contentType = 'image/png';
              ext = 'png';
            } else {
              pipeline = pipeline.webp({ quality: 80 });
              contentType = 'image/webp';
              ext = 'webp';
            }

            const resizedBuffer = await pipeline.toBuffer();
            const resizedMeta = await sharp(resizedBuffer).metadata();

            const oldSlug = mediaData.slug || `image-${mediaId}`;
            const newFilename = `${oldSlug.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, '')}.${ext}`;

            let uploadRes;
            for (let attempt = 1; attempt <= 3; attempt++) {
              uploadRes = await fetch(`${base}/wp-json/wp/v2/media`, {
                method: 'POST',
                headers: getApiHeaders(siteConfig, {
                  'Content-Type': contentType,
                  'Content-Disposition': `attachment; filename="${newFilename}"`
                }),
                body: resizedBuffer as any
              });
              if (uploadRes.ok) break;
              if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
            }

            if (!uploadRes || !uploadRes.ok) continue;
            const newMedia = await uploadRes.json();

            // Copy SEO metadata sang ảnh mới
            const altText = mediaData.alt_text || '';
            const mediaTitle = mediaData.title?.raw || mediaData.title?.rendered || newFilename;
            const caption = mediaData.caption?.raw || '';
            const description = mediaData.description?.raw || '';
            
            await fetch(`${base}/wp-json/wp/v2/media/${newMedia.id}`, {
              method: 'POST',
              headers: getApiHeaders(siteConfig, { 'Content-Type': 'application/json' }),
              body: JSON.stringify({ title: mediaTitle, alt_text: altText, caption, description })
            }).catch(() => {});

            idMapping[mediaId] = {
              newId: newMedia.id,
              newUrl: newMedia.source_url,
              newWidth: resizedMeta.width || tw,
              newHeight: resizedMeta.height || th
            };

            if (deleteOldMedia) mediaToDelete.push(mediaId);

            resizedCount++;
            await new Promise(r => setTimeout(r, 500));

          } catch (imgErr) {
            console.error(`Lỗi resize media ${mediaId}:`, imgErr);
          }
        }

        let thumbMapping: { newId: number, newUrl: string } | null = null;
        if (featuredMediaId && !isCategory) {
          try {
            const mediaRes = await fetch(`${base}/wp-json/wp/v2/media/${featuredMediaId}?context=edit&_fields=id,source_url,alt_text,title,caption,description,slug`, {
              headers: getApiHeaders(siteConfig)
            });
            if (mediaRes.ok) {
              const mediaData = await mediaRes.json();
              const sourceUrl = mediaData.source_url;
              if (sourceUrl) {
                const imgRes = await fetch(sourceUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (imgRes.ok) {
                  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                  let pipeline = sharp(imgBuffer).resize(tw, th, { fit: 'cover', position: 'center' });
                  let contentType: string;
                  let ext: string;
                  if (format === 'jpeg' || format === 'jpg') { pipeline = pipeline.jpeg({ quality: 80 }); contentType = 'image/jpeg'; ext = 'jpg'; }
                  else if (format === 'png') { pipeline = pipeline.png({ quality: 80 }); contentType = 'image/png'; ext = 'png'; }
                  else { pipeline = pipeline.webp({ quality: 80 }); contentType = 'image/webp'; ext = 'webp'; }
                  const resizedBuffer = await pipeline.toBuffer();

                  const oldSlug = mediaData.slug || `image-${featuredMediaId}`;
                  const thumbFilename = `${oldSlug.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, '')}.${ext}`;

                  let uploadRes;
                  for (let attempt = 1; attempt <= 3; attempt++) {
                    uploadRes = await fetch(`${base}/wp-json/wp/v2/media`, {
                      method: 'POST',
                      headers: getApiHeaders(siteConfig, { 'Content-Type': contentType, 'Content-Disposition': `attachment; filename="${thumbFilename}"` }),
                      body: resizedBuffer as any
                    });
                    if (uploadRes.ok) break;
                    if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
                  }

                  if (uploadRes && uploadRes.ok) {
                    const newMedia = await uploadRes.json();
                    const altText = mediaData.alt_text || '';
                    const mediaTitle = mediaData.title?.raw || mediaData.title?.rendered || thumbFilename;
                    const caption = mediaData.caption?.raw || '';
                    const description = mediaData.description?.raw || '';
                    await fetch(`${base}/wp-json/wp/v2/media/${newMedia.id}`, {
                      method: 'POST',
                      headers: getApiHeaders(siteConfig, { 'Content-Type': 'application/json' }),
                      body: JSON.stringify({ title: mediaTitle, alt_text: altText, caption, description })
                    }).catch(() => {});

                    thumbMapping = { newId: newMedia.id, newUrl: newMedia.source_url };

                    if (deleteOldMedia) mediaToDelete.push(featuredMediaId);
                    resizedCount++;
                  }
                }
              }
            }
          } catch (thumbErr) {
            console.error(`[Resize] Lỗi xử lý Thumb ${featuredMediaId}:`, thumbErr);
          }
        }

        if (mediaToDelete.length > 0) {
          for (const delId of mediaToDelete) {
            await fetch(`${base}/wp-json/wp/v2/media/${delId}?force=true`, {
              method: 'DELETE',
              headers: getApiHeaders(siteConfig)
            }).catch(() => {});
          }
        }

        // 5. Cập nhật nội dung bài viết
        if (resizedCount > 0) {
          let updatedContent = content;

          for (const [oldIdStr, mapping] of Object.entries(idMapping)) {
            const oldId = parseInt(oldIdStr);
            const classPattern = `wp-image-${mapping.newId}`;
            
            updatedContent = updatedContent.replace(new RegExp(`wp-image-${oldId}\\b`, 'g'), classPattern);
            updatedContent = updatedContent.replace(new RegExp(`attachment_${oldId}\\b`, 'g'), `attachment_${mapping.newId}`);
            
            updatedContent = updatedContent.replace(new RegExp(`"id"\\s*:\\s*${oldId}\\b`, 'g'), `"id":${mapping.newId}`);
            
            updatedContent = updatedContent.replace(/<img[^>]+>/g, (imgTag: string) => {
              if (new RegExp(`${classPattern}\\b`).test(imgTag)) {
                imgTag = imgTag.replace(/src="[^"]*"/, `src="${mapping.newUrl}"`);
                if (imgTag.includes('width=')) imgTag = imgTag.replace(/width="[^"]*"/, `width="${mapping.newWidth}"`);
                else imgTag = imgTag.replace('<img ', `<img width="${mapping.newWidth}" `);
                if (imgTag.includes('height=')) imgTag = imgTag.replace(/height="[^"]*"/, `height="${mapping.newHeight}"`);
                else imgTag = imgTag.replace('<img ', `<img height="${mapping.newHeight}" `);
                imgTag = imgTag.replace(/srcset="[^"]*"/, `srcset=""`);
                return imgTag;
              }
              return imgTag;
            });
          }

          let newFeaturedMedia = featuredMediaId;
          if (thumbMapping) newFeaturedMedia = thumbMapping.newId;

          const updateBody: any = isCategory
            ? { description: updatedContent }
            : { content: updatedContent, featured_media: newFeaturedMedia };

          await fetch(`${base}/wp-json/wp/v2/${endpoint}/${postInfo.id}`, {
            method: 'POST',
            headers: getApiHeaders(siteConfig, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(updateBody)
          });
        }

        results.push({
          postUrl: trimmedUrl,
          status: 'success',
          message: `Resize thành công ${resizedCount}/${uniqueMediaIds.length} ảnh → ${tw}x${th}.`,
          resizedCount
        });

      } catch (e: any) {
        results.push({ postUrl: trimmedUrl, status: 'error', message: e.message });
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    return NextResponse.json({
      success: true,
      message: `Hoàn tất: ${successCount} thành công, ${errorCount} lỗi.`,
      results
    });

  } catch (error: any) {
    console.error('API /api/wp/resize-images Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
