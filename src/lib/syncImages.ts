import * as cheerio from 'cheerio';
import { escapeHtml } from './html.ts';

export type MediaInfo = { id: number; width?: number; height?: number };
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export function stripExistingImages(content: string): string {
  const stripped = content.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, (block, inner: string) => /<img\b/i.test(inner) ? '' : block);
  const $ = cheerio.load(stripped, {}, false);
  $('figure').each((_, element) => {
    const figure = $(element);
    if (figure.find('img').length && !figure.find('table, video, audio, iframe').length) figure.remove();
  });
  $('p').each((_, element) => {
    const paragraph = $(element);
    if (paragraph.find('img').length && !paragraph.text().trim()) paragraph.remove();
  });
  $('img').remove();
  return $.html();
}

/** Preserve WP text, tables and embeds; anchor images by matching actual text, not array indices. */
export function injectImagesIntoContent(wpContent: string, docsContent: string, imageMap: Map<string, string>, media: Map<string, MediaInfo>): string {
  const $wp = cheerio.load(wpContent, {}, false);
  const $docs = cheerio.load(docsContent, {}, false);
  const wpBlocks = $wp.root().children().toArray();
  const docsBlocks = $docs.root().children().toArray();
  const insertions = new Map<number, string[]>();
  for (let i = 0; i < docsBlocks.length; i++) {
    const block = $docs(docsBlocks[i]);
    const images = block.is('img') ? block : block.find('img');
    if (!images.length) continue;
    let after = -1;
    let anchored = false;
    for (let j = i - 1; j >= 0; j--) {
      const previous = $docs(docsBlocks[j]);
      if (previous.is('img') || previous.find('img').length) continue;
      const text = normalize(previous.text());
      if (!text) continue;
      const matches = wpBlocks.flatMap((el, index) => normalize($wp(el).text()) === text ? [index] : []);
      if (matches.length === 1) { after = matches[0]; anchored = true; break; }
    }
    if (!anchored) {
      for (let j = i + 1; j < docsBlocks.length; j++) {
        const next = $docs(docsBlocks[j]);
        if (next.is('img') || next.find('img').length) continue;
        const text = normalize(next.text());
        if (!text) continue;
        const matches = wpBlocks.flatMap((el, index) => normalize($wp(el).text()) === text ? [index] : []);
        if (matches.length === 1) { after = matches[0] - 1; anchored = true; break; }
      }
    }
    if (!anchored && wpBlocks.some(el => normalize($wp(el).text()))) throw new Error('Không xác định được vị trí ảnh theo nội dung. Bài viết chưa bị thay đổi.');
    images.each((_, el) => {
      const img = $docs(el);
      const src = imageMap.get(img.attr('src') || '');
      if (!src) throw new Error('Thiếu ảnh đã xử lý. Bài viết chưa bị thay đổi.');
      const info = media.get(src);
      const caption = escapeHtml(img.attr('data-temp-caption') || img.attr('alt') || '');
      const html = `<figure class="wp-block-image size-full"><img src="${escapeHtml(src)}" alt="${caption}"${info ? ` class="wp-image-${info.id}" width="${info.width || 800}"${info.height ? ` height="${info.height}"` : ''}` : ''} />${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
      const pending = insertions.get(after) || [];
      pending.push(html); insertions.set(after, pending);
    });
  }
  // Modify the fragment in place, retaining top-level text and Gutenberg comments.
  for (const [index, blocks] of insertions) {
    if (index < 0) $wp.root().prepend(blocks.join('\n'));
    else $wp(wpBlocks[index]).after(blocks.join('\n'));
  }
  return $wp.html();
}
