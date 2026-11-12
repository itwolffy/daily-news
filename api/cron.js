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

function telegramCredentials() {
  const token = (process.env.TG_BOT_TOKEN || '').trim();
  const chat = (process.env.TG_CHAT_ID || '').trim();
  if (!token || !chat) throw new Error('Telegram credentials are not configured');
  return { token, chat };

module.exports.sendTelegram = sendTelegram;
}

function telegramError(message, deliveryOutcome) {
  const error = new Error(message);
  error.deliveryOutcome = deliveryOutcome;
  return error;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegram(messages, onSent) {
  const { token, chat } = telegramCredentials();
  const path = token.startsWith('bot') ? token : 'bot' + token;

  for (let index = 0; index < messages.length; index += 1) {
    let response;
    let attempt = 0;
    while (true) {
      try {
        response = await axios.post(
          'https://api.telegram.org/' + path + '/sendMessage',
          { chat_id: chat, text: messages[index], parse_mode: 'HTML', disable_web_page_preview: true },
          { timeout: 12000 }
        );
        break;
      } catch (error) {
        const status = error.response && error.response.status;
        if (status === 429 && attempt < 2) {
          const retryAfter = Number(error.response.data && error.response.data.parameters &&
            error.response.data.parameters.retry_after);
          const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000;
          // Keep retries bounded so a rate limit cannot consume the entire serverless invocation.
          if (delayMs <= 10000) {
            attempt += 1;
            await wait(delayMs);
            continue;
          }
        }
        if (status >= 400 && status < 500) {
          throw telegramError('Telegram rejected a message (HTTP ' + status + ')', 'rejected');
        }
        // Network errors and server-side errors may have happened after Telegram accepted the message.
        throw telegramError('Telegram delivery outcome is unknown', 'unknown');
      }
    }

    if (!response.data || response.data.ok !== true) {
      throw telegramError('Telegram API rejected a message', 'rejected');
    }
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
  let sentStatePersisted = false;

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

    // Validate local configuration before entering the ambiguous-delivery state.
    telegramCredentials();
    // Persist the sending state before the first network request.
    await store.updateDailyRun(dateKey, lockToken, { status: 'sending', sentMessageCount: 0 });
    deliveryStarted = true;
    await sendTelegram(messages, async count => {
      sentMessageCount = count;
      await store.updateDailyRun(dateKey, lockToken, { status: 'sending', sentMessageCount: count });
    });

    await store.updateDailyRun(dateKey, lockToken, { status: 'sent', sentMessageCount });
    sentStatePersisted = true;
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
      const definitelyRejectedBeforeAnyDelivery =
        deliveryStarted && error.deliveryOutcome === 'rejected' && sentMessageCount === 0;
      if (sentStatePersisted) {
        // The complete digest was acknowledged and its sent state persisted; keep that state.
      } else if (deliveryStarted && !definitelyRejectedBeforeAnyDelivery) {
        // Never release a lock after an ambiguous or partially completed send.
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
        // A definite Telegram 4xx rejection before the first acknowledged message is safe to retry.
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
