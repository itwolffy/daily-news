const crypto = require('node:crypto');
const axios = require('axios');
const { collectAll } = require('../src/collectors');
const { prepareNews } = require('../src/services/news-pipeline');
const { curateNews, fallbackCuration } = require('../src/services/ai-curator');
const { fetchHeaderBar } = require('../src/services/header');
const { buildMessages } = require('../src/renderers/telegram');
const { beijingHeader, beijingDate } = require('../src/utils/date');
const store = require('../src/services/state-store');

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const value = req.headers && req.headers.authorization || '';
  if (!secret || !value.startsWith('Bearer ')) return false;
  const expected = Buffer.from('Bearer ' + secret);
  const actual = Buffer.from(value);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function sendTelegram(messages, onSent) {
  const token = (process.env.TG_BOT_TOKEN || '').trim();
  const chat = (process.env.TG_CHAT_ID || '').trim();
  if (!token || !chat) throw new Error('Telegram credentials are not configured');
  const path = token.startsWith('bot') ? token : 'bot' + token;

  for (let index = 0; index < messages.length; index += 1) {
    const response = await axios.post(
      'https://api.telegram.org/' + path + '/sendMessage',
      { chat_id: chat, text: messages[index], parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 12000 }
    );
    if (!response.data || response.data.ok !== true) throw new Error('Telegram API rejected a message');
    // Persist each acknowledged message before attempting the next one.
    await onSent(index + 1);
  }
}

module.exports = async function cronHandler(req, res) {
  const started = Date.now();
  if (req.method !== 'GET') {
    return res.status(405).setHeader('Allow', 'GET').json({ success: false, error: 'Method Not Allowed' });
  }
  if (!authorized(req)) return res.status(401).json({ success: false, error: 'Unauthorized' });

  const dateKey = beijingDate();
  let lockToken = null;
  let deliveryStarted = false;
  let sentMessageCount = 0;

  try {
    lockToken = await store.claimDailyRun(dateKey);
    if (!lockToken) return res.status(409).json({ success: false, error: 'Daily run already claimed or delivered' });

    await store.updateDailyRun(dateKey, lockToken, { status: 'processing', sentMessageCount: 0 });
    const [collected, headerBar, recent] = await Promise.all([
      collectAll(),
      fetchHeaderBar().catch(error => {
        console.error('[HeaderError]', error.message);
        return '';
      }),
      store.getRecentEvents()
    ]);

    const news = prepareNews(collected.items);
    if (!news.length) throw new Error('No valid news items collected');

    const curated = await curateNews(news, recent);
    const curation = curated || fallbackCuration(news);
    const messages = buildMessages({ dateHeader: beijingHeader(), headerBar, curation });
    if (!messages.length) throw new Error('No Telegram messages generated');

    // Persist the sending state before the first network request. Once this succeeds,
    // any transport error may have an ambiguous delivery result and the lock must be retained.
    await store.updateDailyRun(dateKey, lockToken, { status: 'sending', sentMessageCount: 0 });
    deliveryStarted = true;
    await sendTelegram(messages, async count => {
      sentMessageCount = count;
      await store.updateDailyRun(dateKey, lockToken, { status: 'sending', sentMessageCount: count });
    });

    await store.updateDailyRun(dateKey, lockToken, { status: 'sent', sentMessageCount });
    await store.saveRecentEvents(curation.events, dateKey);
    await store.completeDailyRun(dateKey, lockToken);

    console.log(JSON.stringify({
      event: 'daily_news_completed',
      date: dateKey,
      newsCount: news.length,
      eventCount: curation.events.length,
      messageCount: messages.length,
      aiCurated: Boolean(curated),
      redis: store.redisEnabled(),
      collectorStats: collected.stats,
      durationMs: Date.now() - started
    }));
    return res.status(200).json({
      success: true,
      ai_curated: Boolean(curated),
      news_count: news.length,
      event_count: curation.events.length,
      message_count: messages.length
    });
  } catch (error) {
    console.error('[CronError]', error.message, 'durationMs=' + (Date.now() - started));
    if (lockToken) {
      if (deliveryStarted) {
        // Never release a lock after a send attempt: Telegram has no idempotency key.
        // Keeping the run blocked is safer than silently duplicating a partially delivered digest.
        try {
          await store.updateDailyRun(dateKey, lockToken, {
            status: 'delivery_unknown',
            sentMessageCount,
            error: 'Delivery or post-delivery persistence failed'
          });
        } catch (stateError) {
          console.error('[DeliveryStateError]', stateError.message);
        }
      } else {
        try {
          await store.releaseDailyRun(dateKey, lockToken);
        } catch (releaseError) {
          console.error('[LockReleaseError]', releaseError.message);
        }
      }
    }
    return res.status(500).json({ success: false, error: 'Daily news job failed' });
  }
};
