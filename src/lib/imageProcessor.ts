import sharp from 'sharp';
import * as cheerio from 'cheerio';

interface SiteConfig {
  wp_url: string;
  wp_user: string;
  wp_app_pass: string;
  wp_password?: string;
  wp_login_path?: string;
  image_format?: string; // 'webp', 'jpeg', 'png'
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

      // 2. Chuyển đổi định dạng ảnh theo tuỳ chọn của người dùng (webp, jpeg, png)
      let finalBuffer = buffer;
      let contentType = 'image/webp';
      let ext = 'webp';
      const targetFormat = siteConfig.image_format || 'webp';
      
      if (targetFormat === 'jpeg' || targetFormat === 'jpg') {
        finalBuffer = await sharp(buffer).jpeg({ quality: 80 }).toBuffer();
        contentType = 'image/jpeg';
        ext = 'jpg';
      } else if (targetFormat === 'png') {
        finalBuffer = await sharp(buffer).png({ quality: 80 }).toBuffer();
        contentType = 'image/png';
        ext = 'png';
      } else {
        // Mặc định là webp
        finalBuffer = await sharp(buffer).webp({ quality: 80 }).toBuffer();
        contentType = 'image/webp';
        ext = 'webp';
      }

      const { width, height } = await sharp(finalBuffer).metadata();

      // 3. Đẩy file lên WordPress
      // Tên file chuẩn SEO theo keyword, dọn sạch ký tự tiếng Việt (đ) và non-ASCII
      const safeSlug = keywordSlug.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, "");
      const filename = `${safeSlug}-${i + 1}.${ext}`;
      const authHeader = 'Basic ' + Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
      
      const uploadRes = await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${filename}"`
        },
        body: finalBuffer as any
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
      let altText = rawKeyword; 
      let visibleCaption = '';
      const captionFromDoc = img.attr('data-temp-caption');
      
      if (captionFromDoc) {
          altText = captionFromDoc;
          visibleCaption = captionFromDoc;
      }
      
      // Update WP media
      await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media/${mediaId}`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
           alt_text: altText,
           description: altText,
           caption: visibleCaption
        })
      });

      const captionWidth = width || 800;
      const captionHeight = height || 450;
      
      let classicBlock = '';
      if (visibleCaption) {
          // Nếu có caption thực sự từ Docs, bọc shortcode [caption]
          classicBlock = `\n[caption id="attachment_${mediaId}" align="aligncenter" width="${captionWidth}"]<img class="size-full wp-image-${mediaId}" src="${mediaUrl}" alt="${altText}" width="${captionWidth}" height="${captionHeight}" /> ${visibleCaption}[/caption]\n`;
      } else {
          // Nếu không có caption, chỉ xuất thẻ img (có gắn sẵn class aligncenter để tự động căn giữa)
          classicBlock = `<img class="aligncenter size-full wp-image-${mediaId}" src="${mediaUrl}" alt="${altText}" width="${captionWidth}" height="${captionHeight}" />`;
      }
      
      const parentP = img.closest('p');
      if (parentP.length > 0 && parentP.text().trim() === '') {
        // Thay thế toàn bộ thẻ <p> bằng khối ảnh
        if (visibleCaption) {
             parentP.replaceWith(classicBlock);
        } else {
             // Với thẻ img trần, cứ để nó nằm trong thẻ p cũ nhưng canh giữa (nếu p đã canh giữa)
             parentP.html(classicBlock);
        }
      } else {
        // Nếu ảnh nằm xen kẽ text
        img.replaceWith(classicBlock);
      }
      
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

      let finalBuffer = buffer;
      let contentType = 'image/webp';
      const targetFormat = siteConfig.image_format || 'webp';
      
      // Chuyển đổi định dạng theo cấu hình của người dùng (webp, jpeg, png)
      if (targetFormat === 'jpeg' || targetFormat === 'jpg') {
        finalBuffer = await sharp(buffer).jpeg({ quality: 80 }).toBuffer();
        contentType = 'image/jpeg';
        filename = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '.jpg');
      } else if (targetFormat === 'png') {
        finalBuffer = await sharp(buffer).png({ quality: 80 }).toBuffer();
        contentType = 'image/png';
        filename = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '.png');
      } else {
        // Mặc định là webp
        finalBuffer = await sharp(buffer).webp({ quality: 80 }).toBuffer();
        contentType = 'image/webp';
        filename = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '.webp');
      }

      const safeFilename = filename.replace(/đ/g, 'd').replace(/Đ/g, 'd').replace(/[^a-zA-Z0-9.\-]/g, "");
      const authHeader = 'Basic ' + Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
      
      const uploadRes = await fetch(`${siteConfig.wp_url}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${safeFilename}"`
        },
        body: finalBuffer as any
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
