import { NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

async function updateRankMathViaAdminSession(
  postId: number,
  title: string,
  desc: string,
  keyword: string,
  postType: string,
  siteConfig: any
) {
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const loginPass = siteConfig.wp_password;

  if (!loginPass) return;

  try {
    const loginForm = new URLSearchParams({
      log: siteConfig.wp_user,
      pwd: loginPass,
      'wp-submit': 'Log+In',
      redirect_to: `/wp-admin/`,
      testcookie: '1',
    });
    const loginRes = await fetch(`${base}/wp-login.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': 'wordpress_test_cookie=WP+Cookie+check',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: loginForm.toString(),
      redirect: 'manual',
    });

    const rawCookies = loginRes.headers.getSetCookie?.() ?? [];
    const cookieStr = rawCookies.map((c: string) => c.split(';')[0]).join('; ');

    if (!cookieStr || !cookieStr.includes('wordpress_logged_in')) {
        const errorBody = await loginRes.text();
        console.error(`RankMath External Update: Đăng nhập thất bại (Status: ${loginRes.status}).`);
        return;
    }

    const editPageRes = await fetch(`${base}/wp-admin/post.php?post=${postId}&action=edit`, {
      headers: {
        'Cookie': cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    const editPageHtml = await editPageRes.text();

    const nonceMatch = editPageHtml.match(/"nonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/rankMath.*?"nonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/"restNonce":"([a-f0-9]+)"/i)
      || editPageHtml.match(/rank_math_common_nonce":"([a-f0-9]+)"/i);
    
    if (!nonceMatch) {
      const anyNonce = editPageHtml.match(/[a-f0-9]{10}/i);
      if (!anyNonce) return;
    }
    const nonce = nonceMatch ? nonceMatch[1] : (editPageHtml.match(/[a-f0-9]{10}/i)?.[0] || "");

    await fetch(`${base}/wp-json/rankmath/v1/updateMeta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookieStr,
        'X-WP-Nonce': nonce,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        objectID: postId,
        objectType: postType === 'page' ? 'page' : 'post',
        meta: {
          rank_math_title: title,
          rank_math_description: desc,
          rank_math_focus_keyword: keyword,
          _rank_math_title: title,
          _rank_math_description: desc,
          _rank_math_focus_keyword: keyword,
        },
      }),
    });
  } catch (e) {
    console.error('RankMath Update Error:', e);
  }
}

function convertToSlug(str: string) {
  if (!str) return "";
  return str.toLowerCase().trim()
    .replace(/đ/g, 'd')
    .replace(/[\s_]+/g, '-')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, "");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { siteConfig, googleApiKey, postData } = body;

    // 1. Trích xuất Drive Folder ID
    const folderMatch = postData.drive_folder_url.match(/folders\/([a-zA-Z0-9-_]+)/) || postData.drive_folder_url.match(/id=([a-zA-Z0-9-_]+)/);
    if (!folderMatch) return NextResponse.json({ success: false, message: "Link Drive Folder không hợp lệ." }, { status: 400 });
    const folderId = folderMatch[1];

    // 2. Lấy danh sách file trong Drive
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&fields=files(id,name,webContentLink,mimeType)&key=${googleApiKey}`);
    const driveData = await driveRes.json();
    if (driveData.error) return NextResponse.json({ success: false, message: `Drive Error: ${driveData.error.message}` }, { status: 400 });
    const driveFiles = driveData.files || [];

    // 3. Parse Google Doc
    const docMatch = postData.gdoc_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!docMatch) return NextResponse.json({ success: false, message: "Link Doc không hợp lệ." }, { status: 400 });
    const exportUrl = `https://docs.google.com/document/d/${docMatch[1]}/export?format=html`;
    const docRes = await fetch(exportUrl);
    const html = await docRes.text();
    const $ = cheerio.load(html);

    // Dọn dẹp HTML sơ bộ
    $('style, script, meta').remove();
    $('*').removeAttr('id').removeAttr('class').removeAttr('style');

    const bodyChildren = $('body').children().toArray();
    let metaDesc = "";
    let pageTitle = "";
    let contentNodes: any[] = [];
    let startIdx = 0;

    // Skip first few lines to find Meta and Title (Same as old tool)
    for (let i = 0; i < bodyChildren.length; i++) {
        const text = $(bodyChildren[i]).text().trim();
        if (!text) continue;
        if (!metaDesc) { metaDesc = text; continue; }
        if (!pageTitle) { pageTitle = text; startIdx = i + 1; break; }
    }

    // Logic Nhận diện Chú thích quanh Heading
    for (let i = startIdx; i < bodyChildren.length; i++) {
        const el = bodyChildren[i];
        const tag = el.tagName.toLowerCase();
        
        if (['h2', 'h3', 'h4'].includes(tag)) {
            // Check previous
            if (i > startIdx) {
                const prev = bodyChildren[i-1];
                const prevText = $(prev).text().trim();
                if (prevText && prevText.length < 150 && prev.tagName === 'p') {
                    // It's a caption above
                    $(prev).addClass('is-caption-point').attr('data-caption', prevText);
                }
            }
            // Check next
            if (i < bodyChildren.length - 1) {
                const next = bodyChildren[i+1];
                const nextText = $(next).text().trim();
                if (nextText && nextText.length < 150 && next.tagName === 'p') {
                    // It's a caption below
                    $(next).addClass('is-caption-point').attr('data-caption', nextText);
                }
            }
        }
    }

    const authHeader = 'Basic ' + Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');

    // Xử lý chèn ảnh
    const finalElements = $('body').children().toArray();
    for (const el of finalElements) {
        if ($(el).hasClass('is-caption-point')) {
            const captionText = $(el).attr('data-caption') || "";
            const captionSlug = convertToSlug(captionText);
            
            // Tìm ảnh trong Drive khớp với slug
            const matchFile = driveFiles.find((f: any) => convertToSlug(f.name).includes(captionSlug));
            
            if (matchFile) {
                // Tải ảnh từ Drive (Dùng webContentLink hoặc direct download)
                const fileRes = await fetch(`https://www.googleapis.com/drive/v3/files/${matchFile.id}?alt=media&key=${googleApiKey}`);
                const arrayBuffer = await fileRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                // Chuyển đổi định dạng nếu cần
                const format = postData.imageFormat || 'webp';
                let sharpInstance = sharp(buffer);
                let contentType = 'image/webp';
                let ext = 'webp';

                if (format === 'png') {
                    sharpInstance = sharpInstance.png({ quality: 80 });
                    contentType = 'image/png';
                    ext = 'png';
                } else if (format === 'jpeg') {
                    sharpInstance = sharpInstance.jpeg({ quality: 80 });
                    contentType = 'image/jpeg';
                    ext = 'jpg';
                } else {
                    sharpInstance = sharpInstance.webp({ quality: 80 });
                }

                const outputBuffer = await sharpInstance.toBuffer();
                
                // Upload lên WP
                const formData = new FormData();
                const fileBlob = new Blob([outputBuffer], { type: contentType });
                formData.append('file', fileBlob, `${captionSlug}.${ext}`);
                formData.append('title', captionText);
                formData.append('alt_text', captionText);
                formData.append('caption', captionText);
                formData.append('description', captionText);

                const wpMediaRes = await fetch(`${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/media`, {
                    method: 'POST',
                    headers: { 'Authorization': authHeader },
                    body: formData
                });
                const mediaData = await wpMediaRes.json();

                if (mediaData.id) {
                    const imgHtml = `\n[caption id="attachment_${mediaData.id}" align="aligncenter" width="1200"]<img src="${mediaData.source_url}" alt="${captionText}" class="wp-image-${mediaData.id} size-full" /> ${captionText}[/caption]\n`;
                    $(el).replaceWith(imgHtml);
                }
            }
        }
    }

    const finalContent = $('body').html() || '';
    const finalSlug = convertToSlug(postData.keyword || pageTitle);

    // Đăng bài
    const wpRes = await fetch(`${siteConfig.wp_url.replace(/\/$/, "")}/wp-json/wp/v2/${postData.postType === 'page' ? 'pages' : 'posts'}`, {
        method: 'POST',
        headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            title: pageTitle,
            content: finalContent,
            slug: finalSlug,
            status: postData.status,
            excerpt: metaDesc,
            categories: postData.postType === 'post' ? [postData.categoryId] : []
        })
    });

    const wpData = await wpRes.json();
    if (wpData.id) {
        // Update Rank Math
        updateRankMathViaAdminSession(wpData.id, pageTitle, metaDesc, postData.keyword || "", postData.postType, siteConfig);
        return NextResponse.json({ success: true, url: wpData.link, id: wpData.id });
    }

    return NextResponse.json({ success: false, message: wpData.message || "Lỗi đăng bài" }, { status: 500 });

  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
