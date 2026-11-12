const test = require('node:test');
const assert = require('node:assert/strict');

const { parseTimestamp } = require('../src/utils/date');
const { normalizeNews } = require('../src/services/news-pipeline');
const { zhihuPublicUrl } = require('../src/collectors/community');
const store = require('../src/services/state-store');

// Keep this unit test deterministic even if CI provides Redis credentials.
['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'].forEach(key => delete process.env[key]);

test('invalid and out-of-range timestamps are rejected instead of producing Invalid Date', () => {
  assert.equal(parseTimestamp('not-a-date'), null);
  assert.equal(parseTimestamp(Number.MAX_VALUE), null);
  assert.equal(parseTimestamp(-Number.MAX_VALUE), null);
});

test('news normalization safely drops invalid timestamps while preserving the item', () => {
  const result = normalizeNews([{
    source: 'test',
    category: 'developer',
    title: '有效新闻',
    url: 'https://example.com/news',
    publishedAt: Number.MAX_VALUE,
    summary: '摘要'
  }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].publishedAt, null);
  assert.equal(result[0].timeUnknown, true);
});

test('Zhihu collector prefers a canonical public item URL over a question-ID guess', () => {
  assert.equal(
    zhihuPublicUrl('https://www.zhihu.com/question/123/answer/456', { id: 456 }, 456),
    'https://www.zhihu.com/question/123/answer/456'
  );
});

test('Zhihu collector rejects API URLs and falls back to the related question URL', () => {
  assert.equal(
    zhihuPublicUrl('https://api.zhihu.com/questions/123', { id: 456, question: { id: 123 } }, 456),
    'https://www.zhihu.com/question/123'
  );
});

test('Zhihu collector does not invent a question URL from an answer ID', () => {
  assert.equal(zhihuPublicUrl('', { id: 456, type: 'answer' }, 456), '');
});

test('daily run lock is token-owned and completed runs cannot be claimed again', async () => {
  const day = '2099-01-01';
  const token = await store.claimDailyRun(day);
  assert.equal(typeof token, 'string');
  assert.ok(token.length > 10);
  assert.equal(await store.releaseDailyRun(day, 'not-the-owner'), false);
  await store.updateDailyRun(day, token, { status: 'sending', sentMessageCount: 1 });
  assert.equal(await store.claimDailyRun(day), null);
  await store.completeDailyRun(day, token);
  assert.equal(await store.claimDailyRun(day), null);
});
