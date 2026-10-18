import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';

/**
 * Business rule: contributors append check-spin screenshots after the article.
 * Preserve the original positional rule: remove the last content image, then
 * any remaining images after the final text block. This is not image recognition.
 * Only pass article content here; the separately extracted thumbnail is excluded.
 */
export function removeCheckSpinImages($: CheerioAPI): void {
  const removeImage = (image: Cheerio<Element>) => {
    const paragraph = image.closest('p');
    image.remove();
    if (paragraph.length && !paragraph.text().trim() && !paragraph.find('img').length) paragraph.remove();
  };

  removeImage($('img').last());

  const lastText = $('p, h1, h2, h3, h4, h5, h6, li').filter((_, element) => {
    const clone = $(element).clone();
    clone.find('img').remove();
    return clone.text().trim().length > 0;
  }).last()[0];
  if (!lastText) return;

  let afterLastText = false;
  $('*').each((_, element) => {
    if (element === lastText) afterLastText = true;
    else if (afterLastText && 'tagName' in element && element.tagName.toLowerCase() === 'img' && !$(element).closest(lastText).length) {
      removeImage($(element));
    }
  });
}
