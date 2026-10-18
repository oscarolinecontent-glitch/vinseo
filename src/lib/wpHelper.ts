/** Convert only links to the exact site host, preserving external look-alike domains. */
export function makeInternalLinksRelative(html: string, siteUrl: string): string {
  let site: URL;
  try { site = new URL(siteUrl); } catch { return html; }
  const host = (url: URL) => url.hostname.replace(/^www\./, '').toLowerCase();
  return html.replace(/href=(["'])(https?:\/\/[^"']*)\1/gi, (original, quote: string, value: string) => {
    try {
      const url = new URL(value);
      if (host(url) !== host(site) || url.port !== site.port || url.username || url.password) return original;
      return `href=${quote}${url.pathname}${url.search}${url.hash}${quote}`;
    } catch { return original; }
  });
}
