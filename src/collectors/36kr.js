const { http } = require('../utils/http');

async function fetch36Kr() {
  const { data } = await http.post(
    'https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot',
    { partner_id: 'web', timestamp: Date.now(), param: { siteId: 1, platformId: 2 } },
    { headers: { 'Content-Type': 'application/json', Origin: 'https://36kr.com', Referer: 'https://36kr.com/' } }
  );
  const list = data?.data?.hotRankList || data?.hotRankList || [];
  return list.slice(0, 8).map((entry, index) => {
    const item = entry?.templateMaterial || entry;
    const id = entry?.itemId || item?.itemId || entry?.id || index;
    return {
      source: '36氪',
      category: 'business',
      sourceId: String(id),
      title: item?.widgetTitle || entry?.title || '',
      url: entry?.url || 'https://36kr.com/p/' + id,
      summary: item?.summary || '',
      publishedAt: item?.publishTime || item?.publishedAt || entry?.publishTime || null,
      metrics: { heat: Number(item?.statRead) || 0 }
    };
  }).filter(x => x.title);
}

module.exports = { fetch36Kr };
