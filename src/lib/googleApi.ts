import * as cheerio from 'cheerio';

// Hàm bóc tách nội dung từ link Google Docs (yêu cầu Doc được set quyền "Anyone with the link can view")
export const parseGoogleDoc = async (docUrl: string) => {
  try {
    // 1. Trích xuất Document ID từ URL
    // Hỗ trợ các định dạng:
    // - https://docs.google.com/document/d/{ID}/edit
    // - https://docs.google.com/open?id={ID}
    // - https://drive.google.com/open?id={ID}
    const match = docUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) 
                || docUrl.match(/[?&]id=([a-zA-Z0-9-_]+)/);
    if (!match || !match[1]) {
      throw new Error("Link Google Docs không hợp lệ.");
    }
    const docId = match[1];

    // 2. Fetch nội dung HTML export từ Google Docs (Có cơ chế Retry 3 lần)
    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=html`;
    
    let response;
    let retries = 3;
    while (retries > 0) {
        try {
            response = await fetch(exportUrl);
            if (response.ok) break;

            // Nếu lỗi do quyền (401, 403, 302) thì ngắt luôn không thử lại
            if (response.status === 401 || response.status === 403 || response.status === 302) {
                throw new Error("Không có quyền truy cập Google Doc. Hãy chắc chắn bạn đã đổi quyền chia sẻ thành 'Anyone with the link can view'.");
            }

            // Nếu lỗi server từ phía Google (500, 502, 503) hoặc rate limit (429) -> Đợi 2s rồi thử lại
            if ([500, 502, 503, 429].includes(response.status)) {
                retries--;
                if (retries === 0) {
                    throw new Error(`Lỗi khi tải Google Doc từ server của Google: HTTP ${response.status}. Hãy thử lại sau ít phút.`);
                }
                await new Promise(res => setTimeout(res, 2000)); // Sleep 2s
            } else {
                // Lỗi khác (404...) thì báo ngay
                throw new Error(`Lỗi khi tải Google Doc: HTTP ${response.status}`);
            }
        } catch (networkErr: any) {
            // Lỗi mạng đứt kết nối hoặc DNS
            if (networkErr.message.includes("Không có quyền truy cập") || networkErr.message.includes("Lỗi khi tải Google Doc")) {
                throw networkErr; // Re-throw các lỗi logic đã bắt ở trên
            }
            retries--;
            if (retries === 0) {
                throw new Error(`Lỗi đứt mạng khi kết nối tới Google Docs: ${networkErr.message}. Vui lòng kiểm tra lại mạng.`);
            }
            await new Promise(res => setTimeout(res, 2000));
        }
    }

    if (!response) {
         throw new Error(`Lỗi không xác định khi kết nối tới Google Docs.`);
    }

    const htmlContent = await response.text();
    const $ = cheerio.load(htmlContent);

    // --- XỬ LÝ BOLD / ITALIC TỪ GOOGLE DOCS CSS ---
    // Google Doc lưu định dạng vào thẻ <style> thay vì các thẻ <b> hay <i>
    const styleContent = $('style').html() || '';
    const boldClasses: string[] = [];
    const boldTags: string[] = []; // Chứa tên thẻ có in đậm mặc định
    const italicClasses: string[] = [];
    const italicTags: string[] = [];

    // Hàm phụ trợ trích xuất class từ CSS rule
    const extractSelectors = (matchGroup: string, type: 'bold' | 'italic') => {
        const selectors = matchGroup.split(',').map(s => s.trim()).filter(Boolean);
        for (const sel of selectors) {
            if (sel.startsWith('.')) {
                if (type === 'bold') boldClasses.push(sel.substring(1));
                else italicClasses.push(sel.substring(1));
            } else {
                if (type === 'bold') boldTags.push(sel.toLowerCase());
                else italicTags.push(sel.toLowerCase());
            }
        }
    };

    const boldRegex = /([a-zA-Z0-9_.,\s-]+)\{[^\}]*font-weight:\s*(700|800|900|600|bold)/gi;
    let bMatch;
    while ((bMatch = boldRegex.exec(styleContent)) !== null) {
        extractSelectors(bMatch[1], 'bold');
    }

    const italicRegex = /([a-zA-Z0-9_.,\s-]+)\{[^\}]*font-style:\s*italic/gi;
    let iMatch;
    while ((iMatch = italicRegex.exec(styleContent)) !== null) {
        extractSelectors(iMatch[1], 'italic');
    }

    // Lấy các class căn lề
    const centerClasses: string[] = [];
    const rightClasses: string[] = [];
    const justifyClasses: string[] = [];
    
    // Hàm phụ trợ cho align (chỉ hỗ trợ class)
    const extractClasses = (matchGroup: string) => {
        return matchGroup.split(',').map(s => s.replace('.', '').trim()).filter(Boolean);
    };

    const alignRegex = /\.([^\{]+)\{[^\}]*text-align:\s*(center|right|justify)/g;
    let aMatch;
    while ((aMatch = alignRegex.exec(styleContent)) !== null) {
        const classes = extractClasses(aMatch[1]);
        const alignType = aMatch[2].trim();
        if (alignType === 'center') centerClasses.push(...classes);
        else if (alignType === 'right') rightClasses.push(...classes);
        else if (alignType === 'justify') justifyClasses.push(...classes);
    }

    // Chuyển thẻ span thành thẻ semantic và áp dụng Bold/Italic cho tất cả thẻ (p, h1-h6, span)
    $('span, p, h1, h2, h3, h4, h5, h6, td, th').each((_, el) => {
        const $el = $(el);
        const className = $el.attr('class') || '';
        const tag = (el as any).tagName?.toLowerCase() || '';

        const inlineStyle = ($el.attr('style') || '').toLowerCase().replace(/\s+/g, '');
        
        let isBold = boldTags.includes(tag);
        let isItalic = italicTags.includes(tag);

        if (className) {
            const classes = className.split(' ');
            for (const c of classes) {
                if (boldClasses.includes(c)) isBold = true;
                if (italicClasses.includes(c)) isItalic = true;
            }
        }

        if (inlineStyle.includes('font-weight:700') || inlineStyle.includes('font-weight:bold') || inlineStyle.includes('font-weight:800') || inlineStyle.includes('font-weight:600') || inlineStyle.includes('font-weight:900')) {
            isBold = true;
        }
        if (inlineStyle.includes('font-style:italic')) {
            isItalic = true;
        }

        if (!className && !isBold && !isItalic) {
            if (tag === 'span') {
                $el.replaceWith($el.contents());
            }
            return;
        }

        if (isBold || isItalic) {
            let innerHtml = $el.html() || '';
            if (isBold) innerHtml = `<b>${innerHtml}</b>`;
            if (isItalic) innerHtml = `<i>${innerHtml}</i>`;
            $el.html(innerHtml);
        }

        // Nếu là thẻ span, sau khi đã bọc strong/em ở bên trong thì tháo vỏ span ra
        if (tag === 'span') {
            $el.replaceWith($el.contents());
        }

        // 2. Xử lý Căn lề cho các khối
        if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th'].includes(tag)) {
            let align = '';
            if (className) {
                const classes = className.split(' ');
                for (const c of classes) {
                    if (centerClasses.includes(c)) align = 'center';
                    else if (rightClasses.includes(c)) align = 'right';
                    else if (justifyClasses.includes(c)) align = 'justify';
                }
            }
            if (align) {
                $el.attr('data-temp-align', align);
            }
        }
    });

    // 3. Xử lý Image Caption: Lấy mô tả ảnh từ 2 cấu trúc phổ biến của Google Docs
    $('img').each((index, el) => {
        // Bỏ qua ảnh đầu tiên vì nó là Thumbnail, đoạn text dưới nó là Meta Description chứ không phải Caption
        if (index === 0) return;

        const $img = $(el);
        const $parentP = $img.closest('p');
        if ($parentP.length === 0) return;

        const parentTextAfterImg = $parentP.clone()
            .find('img').remove().end()
            .text().trim();

        if (parentTextAfterImg !== '') {
            // CASE 1: Caption nằm CÙNG thẻ p với ảnh
            // Cấu trúc 1: <p><img><i>Caption</i></p>  (img trực tiếp trong p)
            // Cấu trúc 2: <p><span style="overflow:hidden"><img/></span><span class="c6">Caption</span></p>  (Google Docs non-paged)
            const isShort = parentTextAfterImg.length < 200;
            const hasNoEndPunct = !/[.!:,;]$/.test(parentTextAfterImg.trim());
            
            // Tìm phần tử con TRỰC TIẾP của <p> chứa img (img hoặc wrapper span)
            const $imgDirectChildOfP = $img.parent().is($parentP) ? $img : $img.parentsUntil($parentP).last();
            
            // Nếu là caption hợp lệ thì gán attribute, ngược lại vẫn PHẢI xóa text thừa khỏi <p>
            // để imageProcessor không bị nhầm là có text và dùng replaceWith thay vì html()
            if (isShort && hasNoEndPunct) {
                $img.attr('data-temp-caption', parentTextAfterImg);
            }
            // Xóa tất cả anh em trừ phần tử chứa img (luôn làm để p chỉ còn ảnh)
            $parentP.contents().each((_, node) => {
                if ($(node)[0] !== $imgDirectChildOfP[0]) {
                    $(node).remove();
                }
            });
        } else {
            // CASE 2: Thẻ p chỉ có mỗi ảnh, tìm caption ở các thẻ kế tiếp (bỏ qua khoảng trắng)
            let $currNode = $parentP.next();
            let $captionNode = null;
            let captionText = '';
            let emptyNodesToRemove: any[] = [];
            
            // Rà tối đa 5 node kế tiếp để tìm caption
            for (let i = 0; i < 5; i++) {
                if ($currNode.length === 0) break;
                
                // Nếu gặp thẻ heading hoặc gặp ảnh khác thì dừng (chắc chắn không phải caption)
                const nodeTag = ($currNode[0] as any).tagName?.toLowerCase() || '';
                if (/^h[1-6]$/.test(nodeTag) || $currNode.find('img').length > 0) {
                    break;
                }

                const text = $currNode.text().trim();
                if (text.length === 0) {
                    // Thẻ rỗng (khoảng trắng) -> Đưa vào danh sách chờ xóa để code sạch
                    emptyNodesToRemove.push($currNode);
                    $currNode = $currNode.next();
                } else {
                    // Tìm thấy text! Kiểm tra xem độ dài và dấu câu có phù hợp làm caption không
                    const isShort = text.length < 200;
                    const hasNoEndPunct = !/[.!:,;]$/.test(text);
                    
                    if (isShort && hasNoEndPunct) {
                        $captionNode = $currNode;
                        captionText = text;
                    }
                    break; // Gặp text rồi thì dừng, không rà thêm nữa
                }
            }

            if ($captionNode && captionText) {
                $img.attr('data-temp-caption', captionText);
                $captionNode.remove();
                // Xóa luôn các khoảng trắng giữa ảnh và caption để tránh bị cách một mảng trắng lớn
                emptyNodesToRemove.forEach($node => $node.remove());
            }
        }
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

    // 2. Tìm Title (Anchor Point - Lấy thẻ Heading đầu tiên làm gốc)
    let titleIndex = -1;
    for (let i = currentIndex; i < bodyChildren.length; i++) {
        const el = bodyChildren[i];
        const tag = (el as any).tagName?.toLowerCase() || '';
        const text = $(el).text().trim();
        
        // Tìm thẻ H1, H2, H3... đầu tiên có chứa chữ
        if (/^h[1-6]$/.test(tag) && text.length > 0) {
            titleIndex = i;
            pageTitle = text;
            break;
        }
    }

    // Nếu bài viết không hề có thẻ Heading nào, fallback lấy đoạn text thứ 2 (như cũ)
    if (titleIndex === -1) {
        for (let i = currentIndex; i < bodyChildren.length; i++) {
            const el = bodyChildren[i];
            const text = $(el).text().trim();
            if (text.length > 0 && $(el).find('img').length === 0) {
                if (!metaDesc) {
                    metaDesc = text;
                } else if (!pageTitle) {
                    pageTitle = text;
                    titleIndex = i;
                    break;
                }
            }
        }
    }

    // 3. Tìm Meta Description (Toàn bộ text nằm giữa Drive Link và Title)
    if (titleIndex !== -1) {
        for (let i = currentIndex; i < titleIndex; i++) {
            const el = bodyChildren[i];
            const text = $(el).text().trim();
            if (text.length > 0) {
                metaDesc += (metaDesc ? ' ' : '') + text;
            }
        }
    }

    // 4. Tìm Thumbnail (Hình ảnh đầu tiên xuất hiện trước Title)
    const searchUpTo = titleIndex !== -1 ? titleIndex : bodyChildren.length;
    let thumbUrl = '';
    for (let i = 0; i < searchUpTo; i++) {
        const imgEl = $(bodyChildren[i]).find('img').first();
        if (imgEl.length > 0) {
            thumbUrl = imgEl.attr('src') || '';
            break;
        }
    }

    // 5. Phần còn lại là Content (Mọi thứ từ dưới Title trở đi)
    if (titleIndex !== -1) {
        currentIndex = titleIndex + 1;
    }
    for (let i = currentIndex; i < bodyChildren.length; i++) {
        contentNodes.push(bodyChildren[i]);
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

    // Phục hồi lại Căn lề sau khi đã xóa rác
    $content('p, h1, h2, h3, h4, h5, h6, ul, ol, td, th').each((_, el) => {
        const $el = $content(el);
        const tag = el.tagName.toLowerCase();
        
        const isBlockText = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag);
        let align = $el.attr('data-temp-align');
        
        // Mặc định justify cho các khối văn bản (giống hệt cách làm thủ công)
        if (!align && isBlockText) {
            align = 'justify';
        }

        if (align) {
            $el.attr('style', `text-align: ${align};`);
            $el.removeAttr('data-temp-align');
        }
    });

    // Xóa thẻ p rỗng
    $content('p').each((_, el) => {
        if ($content(el).text().trim() === '' && $content(el).find('img').length === 0) {
            $content(el).remove();
        }
    });

    // --- TÍNH NĂNG MỚI: XÓA ẢNH CHECK ĐẠO VĂN Ở CUỐI BÀI ---
    // Tìm đoạn văn bản (text) cuối cùng của bài viết
    const textNodes = $content('p, h1, h2, h3, h4, h5, h6, li').filter((_, el) => {
        const clone = $content(el).clone();
        clone.find('img').remove(); // Bỏ qua ảnh để kiểm tra thuần text
        return clone.text().trim().length > 0;
    });

    if (textNodes.length > 0) {
        const lastTextNode = textNodes.last()[0];
        let isAfterLastText = false;

        $content('*').each((_, el) => {
            if (el === lastTextNode) {
                isAfterLastText = true;
            } else if (isAfterLastText) {
                // Kiểm tra xem thẻ hiện tại có nằm trong lastTextNode không
                if ($content(el).closest(lastTextNode).length === 0) {
                    if ((el as any).tagName && (el as any).tagName.toLowerCase() === 'img') {
                        const $parentP = $content(el).closest('p');
                        $content(el).remove();
                        // Xóa luôn thẻ p bọc ngoài nếu nó rỗng sau khi xóa ảnh
                        if ($parentP.length > 0 && $parentP.text().trim() === '' && $parentP.find('img').length === 0) {
                            $parentP.remove();
                        }
                    }
                }
            }
        });
    }

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
