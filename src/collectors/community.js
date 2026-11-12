const { http } = require('../utils/http');

function zhihuPublicUrl(rawUrl, target, fallbackId) {
  if (typeof rawUrl === 'string' && rawUrl.trim()) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol === 'https:' && (url.hostname === 'www.zhihu.com' || url.hostname.endsWith('.zhihu.com')) &&
          !url.hostname.startsWith('api.')) {
        return url.href;
      }
    } catch {
      // Fall back to the question URL when the upstream URL is malformed.
    }
  }
  const isQuestion = target?.type === 'question' || !target?.type;
  const questionId = target?.question?.id || (isQuestion ? (target?.id || fallbackId) : null);
  return questionId ? 'https://www.zhihu.com/question/' + encodeURIComponent(String(questionId)) : '';
}

async function fetchCommunity() {
  const [zhihu, v2ex] = await Promise.allSettled([
    http.get('https://api.zhihu.com/topstory/hot-list?limit=10&reverse_order=0', {
      headers: { Referer: 'https://www.zhihu.com/hot' }
    }),
    http.get('https://www.v2ex.com/api/topics/hot.json')
  ]);
  const result = [];

  if (zhihu.status === 'fulfilled') {
    (zhihu.value.data?.data || []).slice(0, 6).forEach((entry, index) => {
      const target = entry?.target || entry;
      const id = target?.id || entry?.id || index;
      const rawUrl = target?.url || entry?.url || '';
      const url = zhihuPublicUrl(rawUrl, target, target?.question?.id || id);
      if (!url) return;
      result.push({
        source: '知乎',
        category: 'community',
        sourceId: String(id),
        title: target?.title || entry?.title || '',
        url,
        summary: target?.excerpt || '',
        publishedAt: target?.created_time || target?.updated_time || null,
        metrics: { heat: Number(String(entry?.detail_text || '').replace(/[^\d.]/g, '')) || 0 },
        meta: { originalUrl: rawUrl || url }
      });
    });
  }

  if (v2ex.status === 'fulfilled') {
    (v2ex.value.data || []).slice(0, 5).forEach(topic => {
      if (!topic?.title) return;
      result.push({
        source: 'V2EX',
        category: 'community',
        sourceId: String(topic.id),
        title: topic.title,
        url: topic.url || 'https://www.v2ex.com/t/' + topic.id,
        summary: (topic.content || '').slice(0, 500),
        publishedAt: topic.created || null,
        metrics: { replies: topic.replies || 0 }
      });
    });
  }
  return result.filter(item => item.title);
}

module.exports = { fetchCommunity, zhihuPublicUrl };
