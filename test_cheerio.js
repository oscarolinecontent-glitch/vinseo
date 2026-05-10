const cheerio = require('cheerio');
const html = `<p>Game bài Nbet hiện đang dẫn.</p><h2>Những ưu điểm nổi bật</h2><p style="text-align: center;"><em>Bảo mật tối tân</em></p><p>Hệ thống đồ họa...</p>`;
const $ = cheerio.load(html, { xmlMode: false });
const elements = $('p, h1, h2, h3, h4, h5, h6').toArray();
for (const el of elements) {
  const $el = $(el);
  const text = $el.text().trim();
  if (text === 'Bảo mật tối tân') {
    $el.replaceWith('\n[caption]<img src="test" /> Bảo mật tối tân[/caption]\n');
  }
}
console.log($('body').html());
