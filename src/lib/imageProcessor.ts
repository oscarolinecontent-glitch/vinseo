import sharp from 'sharp';
import * as cheerio from 'cheerio';

interface SiteConfig {
  wp_url: string;
  wp_user: string;
  wp_app_pass: string;
}

export async function processAndUploadImages(
  htmlContent: string, 
  thumbUrl: string | undefined,
  keywordSlug: string, 
  rawKeyword: string,
  siteConfig: SiteConfig,
  format?: string
): Promise<{ processedHtml: string, thumbnailId: number | null }> {
  let thumbnailId: number | null = null;

  // 0. XỬ LÝ THUMBNAIL (NẾU CÓ)
  if (thumbUrl) {
     const safeSlug = keywordSlug.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, "");
     const extension = format === 'png' ? 'png' : (format === 'jpeg' ? 'jpg' : 'webp');
     const thumbId = await uploadImageToWp(thumbUrl, `${safeSlug}.${extension}`, rawKeyword, siteConfig, format);
     if (thumbId) thumbnailId = thumbId;
  }

  // Load nội dung với Cheerio
  const $ = cheerio.load(htmlContent, { xmlMode: false });
  const images = $('img').toArray();
  
  for (let i = 0; i < images.length; i++) {
    const img = $(images[i]);
    const src = img.attr('src');
    if (!src) continue;

    try {
      let buffer: Buffer;
      
      // 1. Tải ảnh về Buffer
      if (src.startsWith('data:image')) {
        // Ảnh dạng Base64
        const base64Data = src.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        // Ảnh URL (Thường là link lh3.googleusercontent.com)
        let highResUrl = src;
        // BÍ KÍP: Ép Google trả về ảnh gốc Max độ phân giải (Tỉ lệ chuẩn 100%)
        if (highResUrl.includes('googleusercontent.com') && highResUrl.includes('=s')) {
            highResUrl = highResUrl.replace(/=s\d+/, '=s0');
        }
        
        const res = await fetch(highResUrl);
        if (!res.ok) throw new Error('Failed to fetch image from Google');
        const arrayBuffer = await res.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }

      // 2. Chuyển đổi theo định dạng yêu cầu
      let sharpInstance = sharp(buffer);
      if (format === 'png') {
        sharpInstance = sharpInstance.png({ quality: 80 });
      } else if (format === 'jpeg') {
        sharpInstance = sharpInstance.jpeg({ quality: 80 });
      } else {
        sharpInstance = sharpInstance.webp({ quality: 80 });
      }
      
      const outputBuffer = await sharpInstance.toBuffer();
      const extension = format === 'png' ? 'png' : (format === 'jpeg' ? 'jpg' : 'webp');
      const mimeType = format === 'png' ? 'image/png' : (format === 'jpeg' ? 'image/jpeg' : 'image/webp');

      const { width, height } = await sharp(outputBuffer).metadata();

      // 3. Đẩy file lên WordPress
      // Tên file chuẩn SEO theo keyword, dọn sạch ký tự tiếng Việt (đ) và non-ASCII
      const safeSlug = keywordSlug.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, "");
      const filename = `${safeSlug}-${i + 1}.${extension}`;
      const authHeader = 'Basic ' + Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
      
      const uploadRes = await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': mimeType,
          'Content-Disposition': `attachment; filename="${filename}"`
        },
        body: outputBuffer
      });

      if (!uploadRes.ok) {
         console.error('WP Upload failed', await uploadRes.text());
         continue; // Lỗi tải ảnh thì bỏ qua ảnh đó
      }

      const mediaData = await uploadRes.json();
      const mediaId = mediaData.id;
      const mediaUrl = mediaData.source_url;

      // Xóa block set thumbnail cũ đi vì thumbnail đã làm ở bước 0

      // 4. Bơm thông số SEO (Alt, Caption, Description)
      // Tìm thẻ <p> ngay bên dưới ảnh để lấy chú thích làm Alt/Caption
      let seoText = rawKeyword; 
      const nextP = img.closest('p').next('p');
      const captionFromDoc = nextP.text().trim();
      
      if (captionFromDoc && captionFromDoc.length < 150) {
          seoText = captionFromDoc;
          // Xóa đoạn văn này đi vì ta sẽ nhét nó vào trong shortcode [caption]
          nextP.remove();
      }
      
      // Update WP media
      await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media/${mediaId}`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
           alt_text: seoText,
           description: seoText,
           caption: seoText
        })
      });

      // 5. Thay thế thẻ <img> trong bài viết
      // Bọc shortcode [caption] chuẩn của WordPress để căn giữa hoàn hảo
      const captionWidth = width || 1024;
      
      // Gắn thuộc tính mới cho ảnh
      img.attr('src', mediaUrl);
      img.attr('alt', seoText);
      img.removeAttr('width').removeAttr('height');
      img.addClass(`wp-image-${mediaId} size-full`);

      // Kiểm tra nếu thẻ cha là thẻ <p>, ta bọc [caption] quanh thẻ <p> hoặc quanh thẻ <img>
      // WP shortcode format: [caption id="attachment_xx" align="aligncenter" width="xx"]<img .../> Caption text[/caption]
      const imgHtml = $.html(img);
      const shortcodeWrapper = `\n[caption id="attachment_${mediaId}" align="aligncenter" width="${captionWidth}"]${imgHtml} ${seoText}[/caption]\n`;
      
      // Ghi đè thẻ img gốc bằng đoạn shortcode
      img.replaceWith(shortcodeWrapper);
      
    } catch (e) {
      console.error("Lỗi xử lý ảnh:", e);
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
async function uploadImageToWp(src: string, filename: string, seoText: string, siteConfig: SiteConfig, format?: string): Promise<number | null> {
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

      let sharpInstance = sharp(buffer);
      let contentType = 'image/webp';
      if (format === 'png') {
        sharpInstance = sharpInstance.png({ quality: 80 });
        contentType = 'image/png';
      } else if (format === 'jpeg') {
        sharpInstance = sharpInstance.jpeg({ quality: 80 });
        contentType = 'image/jpeg';
      } else {
        sharpInstance = sharpInstance.webp({ quality: 80 });
      }

      const outputBuffer = await sharpInstance.toBuffer();
      const safeFilename = filename.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, "");
      const authHeader = 'Basic ' + Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
      
      const uploadRes = await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${safeFilename}"`
        },
        body: outputBuffer
      });

      if (!uploadRes.ok) return null;
      const mediaData = await uploadRes.json();
      
      // Update SEO
      await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media/${mediaData.id}`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ alt_text: seoText, description: seoText, caption: seoText })
      });

      return mediaData.id;
    } catch (e) {
      return null;
    }
}
