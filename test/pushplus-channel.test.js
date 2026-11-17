const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const pushplus = require('../src/channels/pushplus');

const digest = {
  dateHeader: '2026-11-17 周二',
  headerBar: '',
  curation: {
    dailyInsight: '今日测试摘要',
    events: [{
      id: 'event-1',
      title: '测试新闻',
      summary: '用于验证 PushPlus 微信推送。',
      category: 'developer',
      importance: 4,
      sources: []
    }],
    topStories: []
  }
};

test('PushPlus sends the digest through the WeChat HTML channel', async () => {
  const originalPost = axios.post;
  const previousToken = process.env.PUSHPLUS_TOKEN;
  const requests = [];
  const checkpoints = [];

  try {
    process.env.PUSHPLUS_TOKEN = 'test-pushplus-token';
    axios.post = async (url, body, config) => {
      requests.push({ url, body, config });
      return { data: { code: 200, msg: '请求成功' } };
    };

    const result = await pushplus.deliver(digest, {
      onSent: async count => checkpoints.push(count)
    });

    assert.equal(result.messageCount, 1);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://www.pushplus.plus/send');
    assert.equal(requests[0].body.token, 'test-pushplus-token');
    assert.equal(requests[0].body.channel, 'wechat');
    assert.equal(requests[0].body.template, 'html');
    assert.match(requests[0].body.content, /今日测试摘要/);
    assert.deepEqual(checkpoints, [1]);
  } finally {
    axios.post = originalPost;
    if (previousToken === undefined) delete process.env.PUSHPLUS_TOKEN;
    else process.env.PUSHPLUS_TOKEN = previousToken;
  }
});

test('PushPlus marks a timeout as an unknown delivery outcome', async () => {
  const originalPost = axios.post;
  const previousToken = process.env.PUSHPLUS_TOKEN;

  try {
    process.env.PUSHPLUS_TOKEN = 'test-pushplus-token';
    axios.post = async () => {
      const error = new Error('timeout');
      error.code = 'ECONNABORTED';
      throw error;
    };

    await assert.rejects(
      pushplus.deliver(digest),
      error => error.deliveryOutcome === 'unknown'
    );
  } finally {
    axios.post = originalPost;
    if (previousToken === undefined) delete process.env.PUSHPLUS_TOKEN;
    else process.env.PUSHPLUS_TOKEN = previousToken;
  }
});

test('PushPlus rejects a non-success API response', async () => {
  const originalPost = axios.post;
  const previousToken = process.env.PUSHPLUS_TOKEN;

  try {
    process.env.PUSHPLUS_TOKEN = 'test-pushplus-token';
    axios.post = async () => ({ data: { code: 905, msg: '账号未实名' } });

    await assert.rejects(
      pushplus.deliver(digest),
      error => error.deliveryOutcome === 'rejected' && /905/.test(error.message)
    );
  } finally {
    axios.post = originalPost;
    if (previousToken === undefined) delete process.env.PUSHPLUS_TOKEN;
    else process.env.PUSHPLUS_TOKEN = previousToken;
  }
});
