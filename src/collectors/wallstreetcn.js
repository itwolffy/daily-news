const { http } = require('../utils/http');

async function fetchWallstreetcn() {
  const { data } = await http.get(
    'https://api-one.wallstcn.com/apiv1/content/lives?channel=global-channel&limit=15',
    { headers: { Referer: 'https://wallstreetcn.com/' } }
  );
  return (data?.data?.items || []).slice(0, 10).map(item => {
    const content = (item?.title || item?.content_text ||
      (item?.content || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    return {
      source: '华尔街见闻',
      category: 'finance',
      sourceId: String(item?.id || item?.uri || content.slice(0, 50)),
      title: content.slice(0, 100),
      url: item?.uri || (item?.id ? 'https://wallstreetcn.com/livenews/' + item.id : 'https://wallstreetcn.com/live/global'),
      summary: content,
      publishedAt: item?.display_time || item?.ctime || null,
      metrics: {}
    };
  }).filter(x => x.title);
}

module.exports = { fetchWallstreetcn };
