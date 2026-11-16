const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const telegram = require('../src/channels/telegram');

test('Telegram channel formats the digest with the exported builder before sending', async () => {
  const originalPost = axios.post;
  const previousToken = process.env.TG_BOT_TOKEN;
  const previousChat = process.env.TG_CHAT_ID;
  const requests = [];
  const checkpoints = [];

  try {
    process.env.TG_BOT_TOKEN = 'test-token';
    process.env.TG_CHAT_ID = 'test-chat';
    axios.post = async (url, body) => {
      requests.push({ url, body });
      return { data: { ok: true } };
    };

    const result = await telegram.deliver({
      dateHeader: '2026-11-17 周二',
      headerBar: '',
      curation: {
        dailyInsight: '今日测试摘要',
        events: [{
          id: 'event-1',
          title: '测试新闻',
          summary: '这是一条用于验证 Telegram 格式化和发送流程的测试新闻。',
          category: 'developer',
          importance: 4,
          sources: []
        }],
        topStories: []
      }
    }, {
      onSent: async count => checkpoints.push(count)
    });

    assert.equal(result.messageCount, 1);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/sendMessage$/);
    assert.match(requests[0].body.text, /每日智能早报/);
    assert.match(requests[0].body.text, /今日测试摘要/);
    assert.deepEqual(checkpoints, [1]);
  } finally {
    axios.post = originalPost;
    if (previousToken === undefined) delete process.env.TG_BOT_TOKEN;
    else process.env.TG_BOT_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.TG_CHAT_ID;
    else process.env.TG_CHAT_ID = previousChat;
  }
});
