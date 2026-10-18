import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { stripExistingImages, injectImagesIntoContent } from '../src/lib/syncImages.ts';
import { makeInternalLinksRelative } from '../src/lib/wpHelper.ts';
import { escapeHtml } from '../src/lib/html.ts';

test('image cleanup retains tables, videos, italic/centered prose and Gutenberg comments', () => {
  const content = '<!-- wp:table --><figure class="wp-block-table"><table><tr><td>Data</td></tr></table></figure><!-- /wp:table --><figure><video src="movie.mp4"></video></figure><p><em>Important text</em></p><p style="text-align:center">Centered text</p><figure class="wp-block-image"><img src="old.jpg"><figcaption>Caption</figcaption></figure>[caption id="attachment_1"]<img src="old2.jpg">Old caption[/caption]';
  const result = stripExistingImages(content);
  assert.match(result, /<table>/);
  assert.match(result, /<video/);
  assert.match(result, /Important text/);
  assert.match(result, /Centered text/);
  assert.match(result, /<!-- wp:table -->/);
  assert.doesNotMatch(result, /<img/);
});

test('sync uses exact source mappings and anchors while retaining unrelated WP content', () => {
  const wp = '<p>WordPress-only intro</p><h2>Section</h2><p>Body</p><figure><table><tr><td>Keep</td></tr></table></figure>';
  const docs = '<h2>Section</h2><p><img src="google-a" data-temp-caption="A &quot;quoted&quot; caption"></p><p>Body</p><p><img src="google-b"></p>';
  const result = injectImagesIntoContent(wp, docs, new Map([['google-a', 'https://wp.example/a.jpg'], ['google-b', 'https://wp.example/b.jpg']]), new Map());
  const $ = cheerio.load(result);
  assert.equal($('img').first().attr('src'), 'https://wp.example/a.jpg');
  assert.equal($('img').last().attr('src'), 'https://wp.example/b.jpg');
  assert.equal($('h2').next().find('img').length, 1);
  assert.equal($('table').text(), 'Keep');
  assert.match($.text(), /WordPress-only intro/);
  assert.equal($('img').first().attr('alt'), 'A "quoted" caption');
});

test('sync refuses missing media or unmatched content instead of silently losing images', () => {
  assert.throws(() => injectImagesIntoContent('<p>Anchor</p>', '<p>Anchor</p><img src="missing">', new Map(), new Map()), /Thiếu ảnh/);
  assert.throws(() => injectImagesIntoContent('<p>Changed content</p>', '<p>Old content</p><img src="a">', new Map([['a', 'b']]), new Map()), /vị trí/);
});

test('link conversion preserves look-alike domains and query/hash', () => {
  const html = '<a href="https://example.com/path?a=1#part">Local</a><a href="https://example.com.evil.test/path">External</a><a href="https://www.example.com/">WWW</a>';
  const result = makeInternalLinksRelative(html, 'https://example.com');
  assert.match(result, /href="\/path\?a=1#part"/);
  assert.match(result, /href="https:\/\/example.com.evil.test\/path"/);
  assert.match(result, /href="\/"/);
});

test('generated caption attributes escape markup', () => {
  assert.equal(escapeHtml('<"&\'>'), '&lt;&quot;&amp;&#39;&gt;');
});
