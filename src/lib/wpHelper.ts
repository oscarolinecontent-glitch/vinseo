// Utils cho việc build Request Header và tương tác chung với WordPress API

export const buildWpHeaders = (wpUser: string, wpAppPass: string) => {
  const credentials = Buffer.from(`${wpUser}:${wpAppPass}`).toString('base64');
  return {
    'Authorization': `Basic ${credentials}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 SaaS-AutoPost-v1'
  };
};

/**
 * Chuyển đổi các link nội bộ dạng tuyệt đối (ví dụ: https://domain.com/bai-viet/) 
 * thành link tương đối (ví dụ: /bai-viet/) trong nội dung HTML.
 */
export const makeInternalLinksRelative = (htmlContent: string, siteUrl: string): string => {
  if (!htmlContent || !siteUrl) return htmlContent;
  try {
    const wpHostname = new URL(siteUrl).hostname;
    // Thoát các ký tự đặc biệt của regex trong hostname (như dấu chấm)
    const escapedHostname = wpHostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Bắt các chuỗi href="https://domain.com/path" hoặc href='http://www.domain.com/path'
    const domainRegex = new RegExp(`href=["']https?:\\/\\/(www\\.)?${escapedHostname}(/?[^"']*)["']`, 'gi');
    
    return htmlContent.replace(domainRegex, (match, p1, p2) => {
      const path = p2 || '/';
      return `href="${path.startsWith('/') ? path : '/' + path}"`;
    });
  } catch (e) {
    console.warn("Lỗi khi convert link sang relative:", e);
    return htmlContent;
  }
};
