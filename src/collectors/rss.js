const { http } = require('../utils/http');

const DEFAULT_FEEDS = [
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'business' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', category: 'aiTech' },
  { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', category: 'aiTech' }
];

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === 'x'
        ? parseInt(code.slice(1), 16)
        : Number(code);
      try { return String.fromCodePoint(number); } catch { return ''; }
    });
}

function getTag(block, name) {
  const match = block.match(new RegExp(
    '<(?:[\\w.-]+:)?' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?' + name + '\\s*>',
    'i'
  ));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, ' ').trim()) : '';
}

function getLink(entry) {
  const links = [...entry.matchAll(/<(?:[\w.-]+:)?link\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?link\s*>|<(?:[\w.-]+:)?link\b([^>]*)\/?\s*>/gi)];
  const atomLinks = links.map(match => {
    const attributes = match[1] || match[3] || '';
    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const rel = attributes.match(/\brel\s*=\s*["']([^"']+)["']/i);
    return { url: href ? href[1] : decodeXml(match[2] || ''), rel: rel ? rel[1] : '' };
  }).filter(link => link.url);
  const preferred = atomLinks.find(link => link.rel === 'alternate') || atomLinks[0];
  return decodeXml(preferred ? preferred.url : getTag(entry, 'link'));
}

function parseFeed(xml, feed) {
  const source = String(xml || '');
  const entries = source.match(/<(?:[\w.-]+:)?(item|entry)\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?\1\s*>/gi) || [];
  return entries.slice(0, 12).map((entry, index) => {
    const title = getTag(entry, 'title');
    const url = getLink(entry);
    const summary = getTag(entry, 'description') ||
      getTag(entry, 'summary') ||
      getTag(entry, 'encoded');
    return {
      source: feed.name,
      category: feed.category,
      sourceId: getTag(entry, 'guid') || getTag(entry, 'id') || url || String(index),
      title,
      url,
      summary: summary.slice(0, 1200),
      publishedAt: getTag(entry, 'pubDate') || getTag(entry, 'published') ||
        getTag(entry, 'updated') || getTag(entry, 'date') || null,
      metrics: {}
    };
  }).filter(item => item.title && item.url);
}

async function fetchRss() {
  const custom = (process.env.NEWS_RSS_URLS || '').split(',').map(value => value.trim()).filter(Boolean);
  const feeds = custom.length
    ? custom.map((url, index) => ({ name: 'RSS ' + (index + 1), url, category: 'aiTech' }))
    : DEFAULT_FEEDS;
  const results = await Promise.allSettled(feeds.map(feed =>
    http.get(feed.url, {
      timeout: 7000,
      headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }
    })
  ));
  const items = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(...parseFeed(String(result.value.data || ''), feeds[index]));
    } else {
      console.error('[CollectorError] ' + feeds[index].name, result.reason && result.reason.message);
    }
  });
  return { items };
}

module.exports = { fetchRss, parseFeed, decodeXml };
