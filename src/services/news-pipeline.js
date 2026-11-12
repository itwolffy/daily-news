const crypto = require('node:crypto');
const { parseTimestamp, inWindow } = require('../utils/date');
const CATEGORY_MAP = { aiTech:'AI 与科技', business:'互联网与商业', finance:'宏观经济与投资', developer:'开发者与开源', community:'社区讨论' };
const SOURCE_WEIGHT = { 'OpenAI News':1.15, 'MIT Technology Review':1.15, 'Hacker News':1.05, GitHub:1.05, '华尔街见闻':1.05, '36氪':1, TechCrunch:1.05, '知乎':0.85, V2EX:0.85 };
function stableId(item) {
  const key = item.source + '|' + (item.sourceId || item.url || item.title);
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}
function normalizeNews(items, now = new Date()) {
  return items.map(item => {
    if (!item || !item.title || !item.url) return null;
    let url;
    try { url = new URL(String(item.url)); if (!['http:', 'https:'].includes(url.protocol)) return null; }
    catch { return null; }
    const published = parseTimestamp(item.publishedAt);
    return {
      id: stableId(item), source: String(item.source || '未知来源'),
      category: CATEGORY_MAP[item.category] ? item.category : 'community',
      title: String(item.title).replace(/\s+/g, ' ').trim().slice(0, 300),
      url: url.href, summary: String(item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 1600),
      publishedAt: published ? published.toISOString() : null, timeUnknown: !published,
      collectedAt: now.toISOString(), metrics: item.metrics && typeof item.metrics === 'object' ? item.metrics : {}
    };
  }).filter(item => item && item.title.length > 0);
}
function filterRecentNews(items, now = new Date(), hours = 24) {
  return items.filter(item => !item.publishedAt || inWindow(new Date(item.publishedAt), now, hours));
}
function deduplicateNews(items) {
  const seen = new Set();
  return items.filter(item => {
    const url = new URL(item.url);
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref','source'].forEach(k => url.searchParams.delete(k));
    url.hash = '';
    const canonicalUrl = url.toString().replace(/\/$/, '').toLowerCase();
    const canonicalTitle = item.title.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
    const key = canonicalUrl + '|' + canonicalTitle;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function engagement(metrics = {}) {
  return ['points','comments','stars','forks','replies','heat'].reduce((sum, key) => sum + Math.log1p(Math.max(0, Number(metrics[key]) || 0)), 0);
}
function scoreNews(item, now = new Date()) {
  const source = SOURCE_WEIGHT[item.source] || 0.9;
  const ageHours = item.publishedAt ? Math.max(0, (now.getTime() - Date.parse(item.publishedAt)) / 3600000) : 36;
  const recency = Math.max(0.25, 1 - ageHours / 36);
  const engagementScore = Math.min(1, engagement(item.metrics) / 30);
  const completeness = item.summary.length >= 80 ? 1 : item.summary.length > 0 ? 0.75 : 0.55;
  const unknownPenalty = item.timeUnknown ? 0.65 : 1;
  return Math.round((source * 35 + recency * 30 + engagementScore * 20 + completeness * 15) * unknownPenalty);
}
function prepareNews(rawItems, now = new Date()) {
  return deduplicateNews(filterRecentNews(normalizeNews(rawItems, now), now, 24))
    .map(item => ({ ...item, score: scoreNews(item, now) })).sort((a,b) => b.score-a.score);
}
module.exports = { CATEGORY_MAP, normalizeNews, filterRecentNews, deduplicateNews, scoreNews, prepareNews };
