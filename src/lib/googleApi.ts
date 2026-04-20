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

    // 3. Sử dụng Cheerio để parse HTML
    const $ = cheerio.load(htmlContent);
    
    // Google Doc bọc tất cả vào thẻ <body>
    const bodyHtml = $('body').html() || '';

    // Lấy tiêu đề từ thẻ <title> hoặc <h1> đầu tiên (nếu có)
    const pageTitle = $('title').text() || $('h1').first().text() || "Bài viết không tựa đề";

    // 4. Clean HTML cơ bản (Tuỳ chọn: tối ưu hơn thì parse từng node)
    // Ở đây chúng ta trả về HTML gốc của phần body, WordPress có thể xử lý phần lớn.
    // Thực tế trên App Script bạn đã extract từng paragraph. 
    // Nếu muốn tối ưu cho WP, có thể xóa inline styles.
    
    // Xóa các thẻ script, style ẩn
    $('style, script').remove();
    
    // Một kỹ thuật đơn giản là lấy nội dung body sau khi đã xóa style/script.
    // Việc xử lý class/style chi tiết để thành H2/H3/Strong có thể được map dần, nhưng trước mắt trả về HTML thô để post.
    let cleanContent = $('body').html() || '';

    return {
      success: true,
      title: pageTitle,
      content: cleanContent
    };

  } catch (error: any) {
    return {
      success: false,
      message: error.message
    };
  }
};
