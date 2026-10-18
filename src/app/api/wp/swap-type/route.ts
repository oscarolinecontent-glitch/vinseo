import type { SiteConfig } from '@/lib/types';
import { readJson } from '@/lib/server/request';
import { withApiAuth } from '@/lib/server/auth';
import { safeFetch as fetch } from '@/lib/server/network';
import { NextResponse } from 'next/server';
import dns from 'dns';
import { getWpAdminSession, getWpAdminPath } from '@/lib/wpAuth';
// processAndUploadImages not needed for swap – images already in WP Media Library

dns.setDefaultResultOrder('ipv4first');
export const maxDuration = 300;

type PostType = 'post' | 'page' | 'category' | 'news';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Tìm ID + type từ WP URL (slug hoặc ?p=ID) */
async function resolveSource(
  wpUrl: string,
  base: string,
  headers: Record<string, string>
): Promise<{ id: number; type: PostType } | null> {
  const pMatch = wpUrl.match(/[?&]p=(\d+)/);
  const pgMatch = wpUrl.match(/[?&]page_id=(\d+)/);
  if (pMatch) return { id: +pMatch[1], type: 'post' };
  if (pgMatch) return { id: +pgMatch[1], type: 'page' };

  const slug = new URL(wpUrl).pathname.replace(/\/$/, '').split('/').filter(Boolean).at(-1);
  if (!slug) return null;

  for (const [endpoint, type] of [
    [`posts?slug=${slug}&_fields=id`, 'post'],
    [`pages?slug=${slug}&_fields=id`, 'page'],
    [`categories?slug=${slug}&_fields=id`, 'category'],
  ] as const) {
    const r = await fetch(`${base}/wp-json/wp/v2/${endpoint}`, { headers });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) return { id: data[0].id, type };
    }
  }
  return null;
}

/** Lấy nội dung bài gốc từ WP REST API */
async function fetchSource(id: number, type: PostType, base: string, headers: Record<string, string>) {
  const endpointMap: Record<PostType, string> = {
    category: `${base}/wp-json/wp/v2/categories/${id}`,
    page: `${base}/wp-json/wp/v2/pages/${id}`,
    news: `${base}/wp-json/wp/v2/news/${id}`,
    post: `${base}/wp-json/wp/v2/posts/${id}`,
  };
  const r = await fetch(endpointMap[type], { headers });
  if (!r.ok) throw new Error(`Không lấy được nội dung gốc: HTTP ${r.status}`);
  return r.json();
}

/** Lấy URL ảnh đầu tiên trong HTML */
function firstImgSrc(html: string): string | null {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

/**
 * Tra WP Media Library để lấy attachment ID của một URL ảnh đã có sẵn.
 * Ưu tiên tìm bằng source_url, fallback tìm bằng filename.
 * Trả về ID hoặc null nếu không tìm thấy.
 */
async function findMediaIdByUrl(
  imgUrl: string,
  base: string,
  headers: Record<string, string>
): Promise<number | null> {
  try {
    // Cách 1: source_url exact match
    const r1 = await fetch(`${base}/wp-json/wp/v2/media?source_url=${encodeURIComponent(imgUrl)}&_fields=id,source_url&per_page=1`, { headers });
    if (r1.ok) {
      const data = await r1.json();
      if (Array.isArray(data) && data.length > 0) return data[0].id;
    }

    // Cách 2: search bằng filename (slug của file)
    const filename = imgUrl.split('/').at(-1)?.split('?')[0]?.replace(/\.[^.]+$/, '') || '';
    if (filename) {
      const r2 = await fetch(`${base}/wp-json/wp/v2/media?search=${encodeURIComponent(filename)}&_fields=id,source_url&per_page=5`, { headers });
      if (r2.ok) {
        const data = await r2.json();
        if (Array.isArray(data) && data.length > 0) {
          // Ưu tiên kết quả có URL gần giống nhất
          const match = data.find((m: any) => m.source_url?.includes(filename));
          return match ? match.id : data[0].id;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Cập nhật RankMath meta qua Admin Session (copy y chang logic từ update-post để đảm bảo hoạt động)
 */
async function updateRankMathViaAdminSession(
  objectId: number,
  objectType: PostType,
  title: string,
  desc: string,
  keyword: string,
  categoryId: string | number,
  siteConfig: SiteConfig
) {
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const rmBody = JSON.stringify({
    objectID: objectId,
    objectType: objectType === 'category' ? 'term' : 'post',
    meta: {
      rank_math_title: title,
      rank_math_description: desc,
      rank_math_focus_keyword: keyword,
      rank_math_primary_category: categoryId ? parseInt(categoryId.toString(), 10) : 0,
    },
  });

  try {
    // Cách 1: Admin Session (ưu tiên – bypass mọi firewall)
    const session = await getWpAdminSession(siteConfig);
    if (session) {
      const rmHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Cookie: session.cookieStr,
        'X-WP-Nonce': session.nonce,
        'User-Agent': UA,
        Connection: 'close',
      };

      // Thêm Basic Auth nếu login path chứa user:pass@domain
      const loginPath = siteConfig.wp_login_path || '/wp-login.php';
      const normalizedLoginPath = loginPath.startsWith('http') ? loginPath : (loginPath.startsWith('/') ? loginPath : `/${loginPath}`);
      const loginUrl = normalizedLoginPath.startsWith('http') ? normalizedLoginPath : `${base}${normalizedLoginPath}`;
      try {
        const urlObj = new URL(loginUrl);
        if (urlObj.username && urlObj.password) {
          rmHeaders['Authorization'] = 'Basic ' + Buffer.from(`${urlObj.username}:${urlObj.password}`).toString('base64');
        }
      } catch { /* ignore invalid URL */ }

      const rmRes = await fetch(`${base}/wp-json/rankmath/v1/updateMeta`, { method: 'POST', headers: rmHeaders, body: rmBody });
      const rmData = await rmRes.text();
      console.log('swap-type RankMath Admin Session:', rmRes.status, rmData.slice(0, 200));
      return;
    }

    // Cách 2: Fallback Basic Auth (App Password)
    const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
    const basicHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
      'User-Agent': UA,
      Connection: 'close',
    };
    const rmRes = await fetch(`${base}/wp-json/rankmath/v1/updateMeta`, { method: 'POST', headers: basicHeaders, body: rmBody });
    const rmData = await rmRes.text();
    console.log('swap-type RankMath Basic Auth:', rmRes.status, rmData.slice(0, 200));
  } catch (e) {
    console.error('swap-type RankMath update failed:', e);
  }
}

/** Cập nhật Category description qua wp-admin form để giữ HTML */
async function updateCategoryHtml(
  catId: number,
  name: string,
  slug: string,
  descHtml: string,
  siteConfig: SiteConfig
) {
  const session = await getWpAdminSession(siteConfig);
  if (!session) return;
  const base = siteConfig.wp_url.replace(/\/$/, '');
  const loginPath = siteConfig.wp_login_path || '/wp-login.php';
  const adminBase = getWpAdminPath(loginPath.startsWith('/') ? loginPath : `/${loginPath}`);
  const editUrl = `${base}${adminBase}/term.php?taxonomy=category&tag_ID=${catId}&post_type=post`;
  const getRes = await fetch(editUrl, { headers: { Cookie: session.cookieStr, 'User-Agent': UA } });
  const html = await getRes.text();
  const nonceMatch = html.match(/<input type="hidden" id="_wpnonce" name="_wpnonce" value="([^"]+)"/);
  if (!nonceMatch) return;

  const form = new URLSearchParams({
    action: 'editedtag', tag_ID: `${catId}`, taxonomy: 'category',
    _wpnonce: nonceMatch[1], name, slug, description: descHtml,
  });
  await fetch(`${base}${adminBase}/edit-tags.php`, {
    method: 'POST',
    headers: { Cookie: session.cookieStr, 'Content-Type': 'application/x-www-form-urlencoded', Referer: editUrl },
    body: form.toString(),
  });
}

/** Xoá bài gốc (force=true – không vào Trash) */
async function deleteSource(id: number, type: PostType, base: string, headers: Record<string, string>) {
  const endpointMap: Record<PostType, string> = {
    category: `${base}/wp-json/wp/v2/categories/${id}?force=true`,
    page: `${base}/wp-json/wp/v2/pages/${id}?force=true`,
    news: `${base}/wp-json/wp/v2/news/${id}?force=true`,
    post: `${base}/wp-json/wp/v2/posts/${id}?force=true`,
  };
  const r = await fetch(endpointMap[type], { method: 'DELETE', headers });
  console.log(`swap-type delete ${type} #${id}: HTTP ${r.status}`);
}

export async function POST(req: Request) {
  return withApiAuth(req, async () => {
    try {
      const body = await readJson(req);
      const { siteConfig, wpUrl, targetType, categoryId, status } = body as {
        siteConfig: SiteConfig;
        wpUrl: string;
        targetType: PostType;
        categoryId?: string;
        status?: string;
      };

      if (!siteConfig?.wp_url || !wpUrl || !targetType) {
        return NextResponse.json({ success: false, message: 'Thiếu thông tin đầu vào.' }, { status: 400 });
      }

      let urlToUse = siteConfig.wp_url.trim();
      if (!urlToUse.startsWith('http')) urlToUse = 'https://' + urlToUse;
      siteConfig.wp_url = urlToUse;
      const base = urlToUse.replace(/\/$/, '');
      if ((siteConfig as any).image_width) (siteConfig as any).image_width = +((siteConfig as any).image_width) || undefined;
      if ((siteConfig as any).image_height) (siteConfig as any).image_height = +((siteConfig as any).image_height) || undefined;

      // ── 1. AUTH ──
      const credentials = Buffer.from(`${siteConfig.wp_user}:${siteConfig.wp_app_pass}`).toString('base64');
      let headers: Record<string, string> = {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Connection: 'close',
      };
      const authCheck = await fetch(`${base}/wp-json/wp/v2/users/me`, { headers });
      if (!authCheck.ok) {
        const session = await getWpAdminSession(siteConfig);
        if (session) {
          headers = { Cookie: session.cookieStr, 'X-WP-Nonce': session.nonce, 'Content-Type': 'application/json', 'User-Agent': UA, Connection: 'close' };
          (siteConfig as any).authHeaders = { Cookie: session.cookieStr, 'X-WP-Nonce': session.nonce };
        }
      }

      // ── 2. RESOLVE SOURCE ──
      const source = await resolveSource(wpUrl, base, headers);
      if (!source) return NextResponse.json({ success: false, message: 'Không tìm thấy bài viết từ URL này.' }, { status: 404 });
      if (source.type === targetType) return NextResponse.json({ success: false, message: 'Bài đã ở dạng này rồi.' }, { status: 400 });

      // ── 3. FETCH SOURCE DATA ──
      const src = await fetchSource(source.id, source.type, base, headers);

      const title: string = source.type === 'category' ? src.name : (src.title?.rendered || src.title || '');
      const contentHtml: string = source.type === 'category' ? (src.description || '') : (src.content?.rendered || src.content || '');
      const excerpt: string = source.type === 'category'
        ? ''
        : (src.excerpt?.rendered?.replace(/<[^>]*>/g, '').trim() || '');
      const slug: string = src.slug || '';
      const meta = src.meta || {};

      // RankMath meta (có sẵn nếu plugin register show_in_rest; category thường rỗng)
      const rmTitle: string = meta.rank_math_title || title;
      const rmDesc: string = meta.rank_math_description || excerpt;
      const rmKeyword: string = meta.rank_math_focus_keyword || '';


      // ── 4. THUMBNAIL ──
      let featuredMediaId: number | null = null;

      if (source.type === 'category' && targetType !== 'category') {
        // Category → post/page/news:
        // Ảnh trong category description đã nằm trong WP Media Library → tra ID có sẵn, không re-upload
        const imgUrl = firstImgSrc(contentHtml);
        if (imgUrl) featuredMediaId = await findMediaIdByUrl(imgUrl, base, headers);
        // ponytail: nếu không tìm thấy ID thì bỏ qua thumb (không throw error)
      } else if (source.type !== 'category' && targetType !== 'category') {
        // post/page/news → post/page/news: giữ nguyên featured_media ID cũ
        featuredMediaId = src.featured_media || null;
      }
      // post/page/news → category: không cần thumb

      const finalContent = contentHtml; // ảnh đã là WP URL, không cần re-process

      // ── 5. TẠO BÀI MỚI ──
      let newId: number;
      let newUrl: string;

      if (targetType === 'category') {
        const catSlug = slug || title.toLowerCase().replace(/đ/g, 'd').replace(/[\s_]+/g, '-').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\-]/g, '');
        const createRes = await fetch(`${base}/wp-json/wp/v2/categories`, {
          method: 'POST', headers,
          body: JSON.stringify({ name: title, slug: catSlug, description: '...' }),
        });
        const createText = await createRes.text();

        let catId: number | null = null;
        let catUrl = '';
        if (createRes.ok || createRes.status === 201) {
          const d = JSON.parse(createText); catId = d.id; catUrl = d.link;
        } else {
          try {
            const err = JSON.parse(createText);
            if (err.code === 'term_exists') {
              catId = err.data?.term_id || (Array.isArray(err.additional_data) ? err.additional_data[0] : null);
              if (catId) catUrl = `${base}/category/${catSlug}/`;
            }
          } catch { /* non-JSON */ }
        }
        if (!catId) return NextResponse.json({ success: false, message: `Lỗi tạo category: ${createText.slice(0, 200)}` }, { status: 500 });

        await updateCategoryHtml(catId, title, catSlug, finalContent, siteConfig);
        await updateRankMathViaAdminSession(catId, 'category', rmTitle, rmDesc, rmKeyword, '', siteConfig);
        newId = catId; newUrl = catUrl;

      } else {
        const endpointMap: Partial<Record<PostType, string>> = { post: 'posts', page: 'pages', news: 'news' };
        const newEndpoint = endpointMap[targetType] || 'posts';

        // BƯỚC 1: Tạo bài nháp trước (giống pattern post/route.ts – chiếm slug)
        const initPayload: Record<string, unknown> = {
          title,
          content: '...', // nội dung tạm để chiếm slug trước
          slug,
          status: 'draft',
          meta: {
            rank_math_title: rmTitle,
            rank_math_description: rmDesc,
            rank_math_focus_keyword: rmKeyword,
          },
        };
        if (targetType === 'post') {
          initPayload.excerpt = excerpt;
          if (categoryId) initPayload.categories = [+categoryId];
        } else if (targetType === 'news') {
          initPayload.excerpt = excerpt;
          if (categoryId) initPayload.news_category = [+categoryId];
        }

        const createRes = await fetch(`${base}/wp-json/wp/v2/${newEndpoint}`, { method: 'POST', headers, body: JSON.stringify(initPayload) });
        const createText = await createRes.text();
        if (!createRes.ok && createRes.status !== 201) {
          return NextResponse.json({ success: false, message: `Lỗi tạo ${targetType}: ${createRes.status} - ${createText.slice(0, 300)}` }, { status: 500 });
        }
        const d = JSON.parse(createText);
        newId = d.id; newUrl = d.link;

        // BƯỚC 2: Cập nhật lại với nội dung thật + featured_media + trạng thái cuối
        await fetch(`${base}/wp-json/wp/v2/${newEndpoint}/${newId}`, {
          method: 'POST', headers,
          body: JSON.stringify({
            content: finalContent,
            status: status || 'draft',
            excerpt,
            ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
            meta: {
              rank_math_primary_category: categoryId ? +categoryId : 0,
            },
          }),
        });

        // BƯỚC 3: Ép đè RankMath meta qua Admin Session (giống update-post)
        await updateRankMathViaAdminSession(newId, targetType, rmTitle, rmDesc, rmKeyword, categoryId || '', siteConfig);
      }

      // ── 6. XOÁ BÀI GỐC ──
      await deleteSource(source.id, source.type, base, headers);

      return NextResponse.json({ success: true, newId, newUrl, sourceId: source.id, sourceType: source.type });

    } catch (err: any) {
      console.error('swap-type error:', err);
      return NextResponse.json({ success: false, message: err.message || 'Lỗi không xác định.' }, { status: 500 });
    }
  });
}
