import * as cheerio from 'cheerio';

// Hàm bóc tách nội dung từ link Google Docs (yêu cầu Doc được set quyền "Anyone with the link can view")
export const parseGoogleDoc = async (docUrl: string) => {
  try {
    // 1. Trích xuất Document ID từ URL
    const match = docUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!match || !match[1]) {
      throw new Error("Link Google Docs không hợp lệ.");
    }
    const docId = match[1];

    // 2. Fetch nội dung HTML export từ Google Docs
    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=html`;
    const response = await fetch(exportUrl);
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.status === 302) {
         throw new Error("Không có quyền truy cập Google Doc. Hãy chắc chắn bạn đã đổi quyền chia sẻ thành 'Anyone with the link can view'.");
      }
      throw new Error(`Lỗi khi tải Google Doc: HTTP ${response.status}`);
    }

    const htmlContent = await response.text();
    const $ = cheerio.load(htmlContent);

    // --- XỬ LÝ BOLD / ITALIC TỪ GOOGLE DOCS CSS ---
    // Google Doc lưu định dạng vào thẻ <style> thay vì các thẻ <b> hay <i>
    const styleContent = $('style').html() || '';
    const boldClasses: string[] = [];
    const italicClasses: string[] = [];

    const boldRegex = /\.([^\{]+)\{[^\}]*font-weight:\s*700/g;
    let bMatch;
    while ((bMatch = boldRegex.exec(styleContent)) !== null) {
        boldClasses.push(bMatch[1].trim());
    }

    const italicRegex = /\.([^\{]+)\{[^\}]*font-style:\s*italic/g;
    let iMatch;
    while ((iMatch = italicRegex.exec(styleContent)) !== null) {
        italicClasses.push(iMatch[1].trim());
    }

    // Chuyển thẻ span thành thẻ semantic (chuẩn SEO)
    $('span').each((_, el) => {
        const $el = $(el);
        const className = $el.attr('class') || '';
        let isBold = false;
        let isItalic = false;
        
        const classes = className.split(' ');
        for (const c of classes) {
            if (boldClasses.includes(c)) isBold = true;
            if (italicClasses.includes(c)) isItalic = true;
        }

        let innerHtml = $el.html() || '';
        if (isBold) innerHtml = `<strong>${innerHtml}</strong>`;
        if (isItalic) innerHtml = `<em>${innerHtml}</em>`;
        
        $el.replaceWith(innerHtml);
    });

    // --- BÓC TÁCH NỘI DUNG THEO CẤU TRÚC YÊU CẦU ---
    const bodyChildren = $('body').children();
    
    let driveLink = "";
    let metaDesc = "";
    let pageTitle = "";
    const contentNodes: any[] = [];
    let currentIndex = 0;

    // 1. Tìm Drive Link (Nếu có)
    while (currentIndex < bodyChildren.length) {
        const el = bodyChildren[currentIndex];
        const text = $(el).text().trim();
        
        if (text.length === 0 && $(el).find('img').length === 0) {
            currentIndex++;
            continue;
        }

        if (text.includes('drive.google.com')) {
            driveLink = $(el).find('a').attr('href') || text;
            currentIndex++;
            break;
        } else {
            break; // Không phải Drive Link -> Nó chính là Meta
        }
    }

    // 2. Tìm Meta Description
    while (currentIndex < bodyChildren.length) {
        const el = bodyChildren[currentIndex];
        const text = $(el).text().trim();
        
        if (text.length === 0) {
            currentIndex++;
            continue;
        }

        metaDesc = text;
        currentIndex++;
        break;
    }

    // 3. Tìm Title (H1) — PHẢI là thẻ h1 thực sự, không lấy bừa đoạn văn
    while (currentIndex < bodyChildren.length) {
        const el = bodyChildren[currentIndex];
        const tag = el.tagName?.toLowerCase() || '';
        const text = $(el).text().trim();
        
        if (text.length === 0) {
            currentIndex++;
            continue;
        }

        // Chỉ chấp nhận h1 hoặc nếu không tìm thấy h1 thì lấy phần tử văn bản tiếp theo
        if (tag === 'h1' || tag === 'p') {
            pageTitle = text;
            currentIndex++;
            break;
        }
        
        currentIndex++;
    }

    // 4. Phần còn lại là Content
    for (let i = currentIndex; i < bodyChildren.length; i++) {
        contentNodes.push(bodyChildren[i]);
    }

    // 5. Tìm Thumbnail (Ảnh nằm trên H1)
    let thumbUrl = '';
    for (let i = 0; i < currentIndex; i++) {
        const imgEl = $(bodyChildren[i]).find('img').first();
        if (imgEl.length > 0) {
            thumbUrl = imgEl.attr('src') || '';
            break;
        }
    }

    const $content = cheerio.load('<div></div>');
    $content('div').append(contentNodes);

    // --- DỌN DẸP HTML SẠCH SẼ ---
    $content('style, script, meta').remove();

    // Sửa các đường dẫn Google Redirect (Google hay gắn url?q=...)
    $content('a').each((_, el) => {
        let href = $content(el).attr('href');
        if (href && href.includes('google.com/url?q=')) {
            const urlMatch = href.match(/url\?q=([^&]+)/);
            if (urlMatch && urlMatch[1]) {
                $content(el).attr('href', decodeURIComponent(urlMatch[1]));
            }
        }
    });

    // Xóa ảnh check content ở đoạn cuối cùng (ảnh cuối cùng của bài)
    $content('img').last().remove();

    // Xóa toàn bộ class, id, style inline rác của Google
    $content('*').removeAttr('class').removeAttr('id').removeAttr('style');

    // Xóa thẻ p rỗng
    $content('p').each((_, el) => {
        if ($content(el).text().trim() === '' && $content(el).find('img').length === 0) {
            $content(el).remove();
        }
    });

    // Áp dụng text-align: justify cho từng đoạn văn (không dùng div bọc ngoài để tránh ảnh hưởng ảnh)
    $content('p').each((_, el) => {
      $content(el).attr('style', 'text-align: justify;');
    });

    let cleanContent = $content('div').html() || '';

    return {
      success: true,
      title: pageTitle,
      meta_desc: metaDesc,
      drive_link: driveLink,
      thumb_url: thumbUrl,
      content: cleanContent
    };

  } catch (error: any) {
    return {
      success: false,
      message: error.message
    };
  }
};
