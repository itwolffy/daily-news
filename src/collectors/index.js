const { fetchHackerNews } = require('./hacker-news');
const { fetchGitHubTrending } = require('./github');
const { fetch36Kr } = require('./36kr');
const { fetchWallstreetcn } = require('./wallstreetcn');
const { fetchCommunity } = require('./community');
const { fetchRss } = require('./rss');

// Each collector returns an array of raw NewsItem objects.
const COLLECTORS = [
  { name: 'Hacker News', collect: fetchHackerNews },
  { name: 'GitHub', collect: fetchGitHubTrending },
  { name: '36氪', collect: fetch36Kr },
  { name: '华尔街见闻', collect: fetchWallstreetcn },
  { name: '知乎/V2EX', collect: fetchCommunity },
  { name: 'RSS', collect: async () => (await fetchRss()).items }
];

async function runCollector({ name, collect }) {
  try {
    const result = await collect();
    const items = Array.isArray(result) ? result : [];
    return { name, items, ok: true };
  } catch (error) {
    console.error('[CollectorError] ' + name, error.message);
    return { name, items: [], ok: false };
  }
}

function createCollectorRegistry(collectors = COLLECTORS) {
  if (!Array.isArray(collectors)) throw new TypeError('Collectors must be an array');
  const names = new Set();
  collectors.forEach(collector => {
    if (!collector || typeof collector.name !== 'string' || !collector.name.trim() ||
        typeof collector.collect !== 'function') {
      throw new TypeError('Each collector requires a name and collect function');
    }
    if (names.has(collector.name)) throw new Error('Duplicate collector name: ' + collector.name);
    names.add(collector.name);
  });
  return {
    list: () => collectors.map(({ name }) => name),
    collectAll: async () => {
      const results = await Promise.all(collectors.map(runCollector));
      return {
        items: results.flatMap(result => result.items),
        stats: results.map(result => ({
          source: result.name,
          count: result.items.length,
          ok: result.ok
        }))
      };
    }
  };
}

const defaultRegistry = createCollectorRegistry();

async function collectAll() {
  return defaultRegistry.collectAll();
}

module.exports = { COLLECTORS, createCollectorRegistry, collectAll };
