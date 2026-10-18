import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { removeCheckSpinImages } from '../src/lib/googleDocImages.ts';
import { parseGoogleDoc } from '../src/lib/googleApi.ts';

test('removes the last check-spin screenshot but preserves images inside the article', () => {
  const $ = cheerio.load('<p>Intro</p><p><img src="article.jpg"></p><p>Conclusion</p><p><img src="check-spin.png"></p>', {}, false);
  removeCheckSpinImages($);
  assert.deepEqual($('img').map((_, image) => $(image).attr('src')).get(), ['article.jpg']);
  assert.equal($('p').last().text(), 'Conclusion');
});

test('removes multiple screenshots after the final text, including nested images', () => {
  const $ = cheerio.load('<p><img src="article.jpg"></p><p>Conclusion</p><div><p><span><img src="check-one.png"></span></p><p><img src="check-two.png"></p></div>', {}, false);
  removeCheckSpinImages($);
  assert.deepEqual($('img').map((_, image) => $(image).attr('src')).get(), ['article.jpg']);
});

test('retains the original last-image rule even if a note follows the screenshot', () => {
  const $ = cheerio.load('<p><img src="article.jpg"></p><p>Conclusion</p><p><img src="check-spin.png"></p><p>Contributor note</p>', {}, false);
  removeCheckSpinImages($);
  assert.deepEqual($('img').map((_, image) => $(image).attr('src')).get(), ['article.jpg']);
  assert.match($.text(), /Contributor note/);
});

test('handles articles without images and with only a check screenshot', () => {
  const $ = cheerio.load('<p>Text only</p>', {}, false);
  removeCheckSpinImages($);
  assert.equal($.html(), '<p>Text only</p>');
  const checkOnly = cheerio.load('<p>Conclusion</p><p><img src="check-spin.png"></p>', {}, false);
  removeCheckSpinImages(checkOnly);
  assert.equal(checkOnly('img').length, 0);
  assert.equal(checkOnly('p').length, 1);
});

test('Google Docs parser excludes check screenshots from upload content and preserves thumbnail', async t => {
  const html = '<html><body><p>SEO description</p><p><img src="https://example.com/thumbnail.jpg"></p><h1>Article title</h1><p>Introduction:</p><p><img src="https://example.com/article.jpg"></p><h2>Conclusion</h2><p>Final paragraph:</p><p><img src="https://example.com/check-one.png"></p><p><img src="https://example.com/check-two.png"></p></body></html>';
  t.mock.method(globalThis, 'fetch', async () => new Response(html));
  const result = await parseGoogleDoc('https://docs.google.com/document/d/test-document/edit');
  assert.equal(result.success, true);
  assert.equal(result.thumb_url, 'https://example.com/thumbnail.jpg');
  const $ = cheerio.load(result.content || '');
  assert.deepEqual($('img').map((_, image) => $(image).attr('src')).get(), ['https://example.com/article.jpg']);
  assert.doesNotMatch(result.content || '', /check-one|check-two/);
});
