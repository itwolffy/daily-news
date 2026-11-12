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


test('Redis claim checks prior state and acquires lock in one atomic EVAL', async () => {
  const axios = require('axios');
  const originalPost = axios.post;
  const previousEnv = {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  };
  let command;
  try {
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    axios.post = async (_url, args) => {
      command = args;
      return { data: { result: 1 } };
    };
    const token = await store.claimDailyRun('2099-01-02');
    assert.equal(typeof token, 'string');
    assert.equal(command[0], 'EVAL');
    assert.equal(command[2], '2');
    assert.match(command[3], /redis\.call\('GET', KEYS\[2\]\)/);
    assert.match(command[3], /redis\.call\('SET', KEYS\[1\].*'NX'/);
    assert.match(command[3], /redis\.call\('SET', KEYS\[2\]/);
  } finally {
    axios.post = originalPost;
    if (previousEnv.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousEnv.url;
    if (previousEnv.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousEnv.token;
  }
});

test('Telegram retries a bounded 429 response and continues after success', async () => {
  const axios = require('axios');
  const { sendTelegram } = require('../api/cron');
  const originalPost = axios.post;
  const previousToken = process.env.TG_BOT_TOKEN;
  const previousChat = process.env.TG_CHAT_ID;
  let attempts = 0;
  try {
    process.env.TG_BOT_TOKEN = 'test-token';
    process.env.TG_CHAT_ID = 'test-chat';
    axios.post = async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('rate limited');
        error.response = { status: 429, data: { parameters: { retry_after: 0.001 } } };
        throw error;
      }
      return { data: { ok: true } };
    };
    const checkpoints = [];
    await sendTelegram(['digest'], async count => checkpoints.push(count));
    assert.equal(attempts, 2);
    assert.deepEqual(checkpoints, [1]);
  } finally {
    axios.post = originalPost;
    if (previousToken === undefined) delete process.env.TG_BOT_TOKEN;
    else process.env.TG_BOT_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.TG_CHAT_ID;
    else process.env.TG_CHAT_ID = previousChat;
  }
});

test('Telegram marks a definite 4xx rejection separately from an ambiguous network error', async () => {
  const axios = require('axios');
  const { sendTelegram } = require('../api/cron');
  const originalPost = axios.post;
  const previousToken = process.env.TG_BOT_TOKEN;
  const previousChat = process.env.TG_CHAT_ID;
  try {
    process.env.TG_BOT_TOKEN = 'test-token';
    process.env.TG_CHAT_ID = 'test-chat';
    axios.post = async () => {
      const error = new Error('bad request');
      error.response = { status: 400, data: { description: 'Bad Request' } };
      throw error;
    };
    await assert.rejects(
      sendTelegram(['digest'], async () => {}),
      error => error.deliveryOutcome === 'rejected'
    );
  } finally {
    axios.post = originalPost;
    if (previousToken === undefined) delete process.env.TG_BOT_TOKEN;
    else process.env.TG_BOT_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.TG_CHAT_ID;
    else process.env.TG_CHAT_ID = previousChat;
  }
});
