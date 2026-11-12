const { http } = require('../utils/http');

async function fetchHackerNews() {
  const { data } = await http.get('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=10');
  return (data?.hits || []).filter(x => x?.title).map(x => ({
    source: 'Hacker News',
    category: 'developer',
    sourceId: String(x.objectID),
    title: x.title,
    url: x.url || 'https://news.ycombinator.com/item?id=' + x.objectID,
    summary: x.story_text || '',
    publishedAt: x.created_at_i,
    metrics: { points: x.points || 0, comments: x.num_comments || 0 }
  }));
}

module.exports = { fetchHackerNews };
