const cheerio = require('cheerio');
const html = '<html><head></head><body><p><img src="1.jpg"></p></body></html>';
const $ = cheerio.load(html);
$('img').closest('p').replaceWith('[caption]<img src="2.jpg">[/caption]');
console.log($.html());
