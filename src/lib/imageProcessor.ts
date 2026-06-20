import sharp from 'sharp';
import * as cheerio from 'cheerio';

interface SiteConfig {
  wp_url: string;
  wp_user: string;
  wp_app_pass: string;
  wp_password?: string;
  wp_login_path?: string;
  image_format?: string; // 'webp', 'jpeg', 'png'
  image_width?: number;  // Chiều rộng mục tiêu (vd: 800)
  image_height?: number; // Chiều cao mục tiêu (vd: 450)
  authHeaders?: any; // Dùng để bypass WAF nếu có Session Cookie
}

/**
 * Helper: Tạo sharp pipeline với resize (nếu có) + convert format
 * Trả về { buffer, contentType, ext, width, height }
 */
async function buildSharpOutput(inputBuffer: Buffer, siteConfig: SiteConfig): Promise<{
  buffer: Buffer; contentType: string; ext: string; width: number; height: number;
}> {
  let pipeline = sharp(inputBuffer);

  // Resize nếu user có cấu hình kích thước
  const tw = siteConfig.image_width;
  const th = siteConfig.image_height;
  if (tw && th && tw > 0 && th > 0) {
    pipeline = pipeline.resize(tw, th, { fit: 'cover', position: 'center' });
  } else if (tw && tw > 0) {
    pipeline = pipeline.resize(tw, undefined, { fit: 'inside', withoutEnlargement: true });
  }

  // Convert format
  const targetFormat = siteConfig.image_format || 'webp';
  let contentType: string;
  let ext: string;

  if (targetFormat === 'jpeg' || targetFormat === 'jpg') {
    pipeline = pipeline.jpeg({ quality: 80 });
    contentType = 'image/jpeg';
    ext = 'jpg';
  } else if (targetFormat === 'png') {
    pipeline = pipeline.png({ quality: 80 });
    contentType = 'image/png';
    ext = 'png';
  } else {
    pipeline = pipeline.webp({ quality: 80 });
    contentType = 'image/webp';
    ext = 'webp';
  }

  const finalBuffer = await pipeline.toBuffer();
  const meta = await sharp(finalBuffer).metadata();

  return {
    buffer: finalBuffer,
    contentType,
    ext,
    width: meta.width || 800,
    height: meta.height || 450
  };
}

function getApiHeaders(siteConfig: SiteConfig, additionalHeaders: any = {}) {
  const headers = siteConfig.authHeaders ? { ...siteConfig.authHeaders } : {
    'Authorization': 'Basic ' + Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64')
  };
  return { ...headers, ...additionalHeaders };
}

export async function processAndUploadImages(
  htmlContent: string, 
  thumbUrl: string | undefined,
  keywordSlug: string, 
  rawKeyword: string,
  siteConfig: SiteConfig
): Promise<{ processedHtml: string, thumbnailId: number | null }> {
  let thumbnailId: number | null = null;

  // 0. XỬ LÝ THUMBNAIL (NẾU CÓ)
  if (thumbUrl) {
     const safeSlug = keywordSlug.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, "");
     const thumbId = await uploadImageToWp(thumbUrl, `${safeSlug}.webp`, rawKeyword, siteConfig);
     if (thumbId) thumbnailId = thumbId;
  }

  // Load nội dung với Cheerio
  const $ = cheerio.load(htmlContent, { xmlMode: false });
  const images = $('img').toArray();
  
  // Xử lý ảnh song song theo batch (ví dụ: 3 ảnh/lần) để tối ưu thời gian. Ảnh nào lỗi sẽ tự động retry độc lập.
  const BATCH_SIZE = 3;
  const results: Array<{ index: number; classicBlock: string; imgNode: any }> = [];

  for (let batchStart = 0; batchStart < images.length; batchStart += BATCH_SIZE) {
    const batch = images.slice(batchStart, batchStart + BATCH_SIZE);

    const batchResults = await Promise.all(batch.map(async (imgEl, batchIndex) => {
      const i = batchStart + batchIndex;
      const img = $(imgEl);
      const src = img.attr('src');
      if (!src) return null;

      try {
        let buffer: Buffer;
        
        if (src.startsWith('data:image')) {
          const base64Data = src.split(',')[1];
          buffer = Buffer.from(base64Data, 'base64');
        } else {
          let highResUrl = src;
          if (highResUrl.includes('googleusercontent.com') && highResUrl.includes('=s')) {
              highResUrl = highResUrl.replace(/=s\d+/, '=s0');
          }
          const res = await fetch(highResUrl);
          if (!res.ok) throw new Error('Failed to fetch image from Google');
          buffer = Buffer.from(await res.arrayBuffer());
        }

        // Resize (nếu có cấu hình) + Convert format bằng helper chung
        const sharpResult = await buildSharpOutput(buffer, siteConfig);
        const finalBuffer = sharpResult.buffer;
        const contentType = sharpResult.contentType;
        const ext = sharpResult.ext;
        const width = sharpResult.width;
        const height = sharpResult.height;

        const safeSlug = keywordSlug.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, "");
        const filename = `${safeSlug}-${i + 1}.${ext}`;
        
        // Thử upload lên WP tối đa 3 lần nếu server bị lỗi 502/504
        let uploadRes;
        let uploadRetries = 3;
        while (uploadRetries > 0) {
           uploadRes = await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media`, {
             method: 'POST',
             headers: getApiHeaders(siteConfig, {
               'Content-Type': contentType,
               'Content-Disposition': `attachment; filename="${filename}"`
             }),
             body: finalBuffer as any
           });

           if (uploadRes.ok) break;
           uploadRetries--;
           if (uploadRetries > 0) {
              await new Promise(r => setTimeout(r, 2000)); // Đợi 2s rồi thử lại
           }
        }

        if (!uploadRes || !uploadRes.ok) {
           console.error('WP Upload failed', uploadRes ? await uploadRes.text() : 'No response');
           return null;
        }

        const mediaData = await uploadRes.json();
        const mediaId = mediaData.id;
        const mediaUrl = mediaData.source_url;

        let altText = rawKeyword; 
        let visibleCaption = '';
        const captionFromDoc = img.attr('data-temp-caption');
        
        if (captionFromDoc) {
            altText = captionFromDoc;
            visibleCaption = captionFromDoc;
        }
        
        await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media/${mediaId}`, {
          method: 'POST',
          headers: getApiHeaders(siteConfig, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({ alt_text: altText, description: altText, caption: visibleCaption })
        });

        const captionWidth = width || 800;
        const captionHeight = height || 450;
        
        let classicBlock = '';
        if (visibleCaption) {
            classicBlock = `[caption id="attachment_${mediaId}" align="aligncenter" width="${captionWidth}"]<img class="size-full wp-image-${mediaId}" src="${mediaUrl}" alt="${altText}" width="${captionWidth}" height="${captionHeight}" /> ${visibleCaption}[/caption]`;
        } else {
            classicBlock = `<img class="aligncenter size-full wp-image-${mediaId}" src="${mediaUrl}" alt="${altText}" width="${captionWidth}" height="${captionHeight}" />`;
        }

        return { index: i, classicBlock, imgNode: img };
      } catch (e) {
        console.error(`Lỗi xử lý ảnh ${i}:`, e);
        return null;
      }
    }));

    // Gán kết quả vào HTML theo đúng thứ tự
    for (const result of batchResults) {
      if (!result) continue;
      const { classicBlock, imgNode } = result;
      const parentP = imgNode.closest('p');
      if (parentP.length > 0 && parentP.text().trim() === '') {
        parentP.html(classicBlock);
        parentP.attr('style', 'text-align: center;');
      } else {
        imgNode.replaceWith(classicBlock);
      }
    }
  }

  // Lấy ra HTML sau khi đã thay thế sạch sẽ
  // Cheerio tự thêm thẻ <body> nên cần lấy html bên trong body
  let finalHtml = $('body').html() || $.html();
  
  return { 
    processedHtml: finalHtml, 
    thumbnailId 
  };
}

// Hàm phụ trợ tải ảnh lên WP
async function uploadImageToWp(src: string, filename: string, seoText: string, siteConfig: SiteConfig): Promise<number | null> {
    try {
      let buffer: Buffer;
      if (src.startsWith('data:image')) {
        const base64Data = src.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        let highResUrl = src;
        if (highResUrl.includes('googleusercontent.com') && highResUrl.includes('=s')) {
            highResUrl = highResUrl.replace(/=s\d+/, '=s0');
        }
        const res = await fetch(highResUrl);
        if (!res.ok) return null;
        buffer = Buffer.from(await res.arrayBuffer());
      }

      // Resize (nếu có cấu hình) + Convert format bằng helper chung
      const sharpResult = await buildSharpOutput(buffer, siteConfig);
      const finalBuffer = sharpResult.buffer;
      const contentType = sharpResult.contentType;
      filename = filename.replace(/\.(png|jpg|jpeg|webp)$/i, `.${sharpResult.ext}`);

      const safeFilename = filename.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, "");
      const uploadRes = await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: getApiHeaders(siteConfig, {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${safeFilename}"`
        }),
        body: finalBuffer as any
      });

      if (!uploadRes.ok) return null;
      const mediaData = await uploadRes.json();
      
      // Update SEO
      await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media/${mediaData.id}`, {
        method: 'POST',
        headers: getApiHeaders(siteConfig, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ alt_text: seoText, description: seoText, caption: seoText })
      });

      return mediaData.id;
      return mediaData.id;
    } catch (e) {
      return null;
    }
}

// =========================================================================
// PHẦN XỬ LÝ ẢNH THEO DẠNG CHÚ THÍCH (TÌM ẢNH ĐÃ UPLOAD SẴN TRÊN WP)
// =========================================================================

function convertToSlug(str: string) {
  if (!str) return "";
  str = String(str).toLowerCase().trim();
  str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
  str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
  str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
  str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
  str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
  str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
  str = str.replace(/đ/g, "d");
  str = str.replace(/[^a-z0-9 -]/g, "");
  str = str.replace(/\s+/g, "-");        
  str = str.replace(/-+/g, "-");         
  return str.replace(/^-+|-+$/g, "");
}

async function getMediaDataByFilename(filename: string, siteConfig: SiteConfig, globalUsedMediaIds: number[]): Promise<any> {
  const cleanName = filename.replace(/\.(webp|jpg|png|jpeg)$/i, "");
  const options = {
    method: "GET",
    headers: getApiHeaders(siteConfig, {
      "User-Agent": "Mozilla/5.0"
    })
  };

  const fetchWithRetry = async (url: string) => {
    for (let i = 1; i <= 3; i++) {
      try {
        const res = await fetch(url, options);
        if (res.ok) return await res.json();
      } catch (e) {
        if (i === 3) return null;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    return null;
  };

  // Bước 1: Tìm chính xác theo slug
  const urlSlug = `${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/media?slug=${encodeURIComponent(cleanName)}`;
  const dataSlug = await fetchWithRetry(urlSlug);
  
  if (dataSlug && dataSlug.length > 0) {
    let matchedId = dataSlug[0].id;
    if (!globalUsedMediaIds.includes(matchedId)) {
      globalUsedMediaIds.push(matchedId);
      return { id: matchedId, url: dataSlug[0].source_url, w: dataSlug[0].media_details?.width, h: dataSlug[0].media_details?.height };
    }
  }

  // Bước 2: Tìm mờ bằng 5 từ đầu
  let wordsArray = cleanName.split("-");
  let shortName = wordsArray.length > 5 ? wordsArray.slice(0, 5).join("-") : cleanName;
  
  const urlSearch = `${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/media?search=${encodeURIComponent(shortName)}`;
  const dataSearch = await fetchWithRetry(urlSearch);
  
  if (dataSearch && dataSearch.length > 0) {
    let availableMedia = dataSearch.filter((d: any) => !globalUsedMediaIds.includes(d.id));
    if (availableMedia.length > 0) {
      for(let d of availableMedia) {
        if(d.source_url && d.source_url.includes(shortName)) {
          globalUsedMediaIds.push(d.id);
          return { id: d.id, url: d.source_url, w: d.media_details?.width, h: d.media_details?.height };
        }
      }
      globalUsedMediaIds.push(availableMedia[0].id);
      return { id: availableMedia[0].id, url: availableMedia[0].source_url, w: availableMedia[0].media_details?.width, h: availableMedia[0].media_details?.height };
    }
  }
  
  return null;
}

export async function processImagesByCaption(
  htmlContent: string,
  title: string,
  siteConfig: SiteConfig
): Promise<{ processedHtml: string, thumbnailId: number | null }> {
  
  const globalUsedMediaIds: number[] = [];
  
  // 1. Tìm Thumbnail dựa trên H1 (Title)
  const h1Slug = convertToSlug(title);
  const thumbData = await getMediaDataByFilename(h1Slug, siteConfig, globalUsedMediaIds);
  let thumbnailId: number | null = null;
  
  if (thumbData) {
      thumbnailId = thumbData.id;
      // Update SEO cho thumbnail
      await fetch(`${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/media/${thumbnailId}`, {
        method: 'POST',
        headers: getApiHeaders(siteConfig, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ alt_text: title, caption: title, description: title })
      }).catch(() => {});
  }

  // 2. Load nội dung với Cheerio và rà soát chú thích
  const $ = cheerio.load(htmlContent, { xmlMode: false });
  let lastHeadingText = "";

  const elements = $('p, h1, h2, h3, h4, h5, h6').toArray();

  for (const el of elements) {
      const $el = $(el);
      const tag = el.tagName.toLowerCase();
      const text = $el.text().trim();
      
      if (text.length === 0) continue;

      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
          lastHeadingText = text;
          continue;
      }

      if (tag === 'p') {
          const style = $el.attr('style') || '';
          const htmlStr = $el.html() || '';
          const isCentered = style.includes('text-align: center') || style.includes('text-align:center');
          const isItalic = htmlStr.includes('<i') || htmlStr.includes('<em') || htmlStr.includes('font-style: italic') || htmlStr.includes('font-style:italic');
          const isMatchLastHeading = (lastHeadingText !== "" && text.toLowerCase() === lastHeadingText.toLowerCase());
          
          // Điều kiện xử lý: Cho phép có dấu chấm (.) ở cuối câu để nhận diện chú thích tốt hơn
          const hasNoEndPunctuation = !/[!:,;]$/.test(text.trim());
          
          // Chú thích: thẻ p, nội dung < 200 ký tự, và (căn giữa HOẶC in nghiêng HOẶC giống heading)
          const isShortCaption = text.length > 2 && text.length < 200 && hasNoEndPunctuation && (isCentered || isItalic || isMatchLastHeading);

          if (isShortCaption) {
              const captionSlug = convertToSlug(text);
              const mediaData = await getMediaDataByFilename(captionSlug, siteConfig, globalUsedMediaIds);
              
              if (mediaData && mediaData.id) {
                  // Cập nhật thẻ SEO của ảnh
                  await fetch(`${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/media/${mediaData.id}`, {
                    method: 'POST',
                    headers: getApiHeaders(siteConfig, { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ alt_text: text, caption: text, description: text })
                  }).catch(() => {});

                  const captionWidth = mediaData.w || 1200;
                  const captionHeight = mediaData.h || 800;
                  
                  const classicBlock = `[caption id="attachment_${mediaData.id}" align="aligncenter" width="${captionWidth}"]<img class="size-full wp-image-${mediaData.id}" src="${mediaData.url}" alt="${text}" width="${captionWidth}" height="${captionHeight}" /> ${text}[/caption]`;
                  
                  $el.html(classicBlock);
                  $el.attr('style', 'text-align: center;');
              } else {
                  // Nếu không tìm thấy, tạo một thẻ img mẫu
                  const generatedImageUrl = `/wp-content/uploads/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${captionSlug}.webp`;
                  const classicBlock = `[caption align="aligncenter"]<img src="${generatedImageUrl}" alt="${text}" class="size-full" /> ${text}[/caption]`;
                  $el.html(classicBlock);
                  $el.attr('style', 'text-align: center;');
              }
              
              lastHeadingText = ""; // Reset
          }
      }
  }

  let finalHtml = $('body').html() || $.html();

  // Bơm thumbnail lên đầu nếu không tìm thấy
  if (!thumbnailId) {
      const generatedThumbUrl = `/wp-content/uploads/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${h1Slug}.webp`;
      finalHtml = `<p style="text-align: center;"><img src="${generatedThumbUrl}" alt="${title}" class="size-full" /></p>\n` + finalHtml;
  }

  return { 
    processedHtml: finalHtml, 
    thumbnailId 
  };
}
