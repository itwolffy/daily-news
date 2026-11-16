const { collectAll } = require('../collectors');
const { prepareNews } = require('../services/news-pipeline');
const { curateNews, fallbackCuration } = require('../services/ai-curator');
const { fetchHeaderBar } = require('../services/header');
const { beijingHeader, beijingDate } = require('../utils/date');
const store = require('../services/state-store');
const telegram = require('../channels/telegram');

async function runDailyNewsJob() {
  const started = Date.now();
  const dateKey = beijingDate();
  let lockToken = null;
  let deliveryStarted = false;
  let sentMessageCount = 0;
  let sentStatePersisted = false;

  try {
    lockToken = await store.claimDailyRun(dateKey);
    if (!lockToken) {
      const error = new Error('Daily run already claimed or delivered');
      error.statusCode = 409;
      throw error;
    }

    await store.updateDailyRun(dateKey, lockToken, {
      status: 'processing',
      sentMessageCount: 0
    });

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
    const digest = {
      dateHeader: beijingHeader(),
      headerBar,
      curation
    };

    // Validate local channel configuration before entering the ambiguous-delivery state.
    telegram.validateConfig();

    await store.updateDailyRun(dateKey, lockToken, {
      status: 'sending',
      sentMessageCount: 0
    });
    deliveryStarted = true;

    const delivery = await telegram.deliver(digest, {
      onSent: async count => {
        sentMessageCount = count;
        await store.updateDailyRun(dateKey, lockToken, {
          status: 'sending',
          sentMessageCount: count
        });
      }
    });

    await store.updateDailyRun(dateKey, lockToken, {
      status: 'sent',
      sentMessageCount
    });
    sentStatePersisted = true;

    // History persistence must not cause an already delivered digest to be sent again.
    await store.saveRecentEvents(curation.events, dateKey);
    await store.completeDailyRun(dateKey, lockToken);

    console.log(JSON.stringify({
      event: 'daily_news_completed',
      date: dateKey,
      newsCount: news.length,
      eventCount: curation.events.length,
      messageCount: delivery.messageCount,
      aiCurated: Boolean(curated),
      redis: store.redisEnabled(),
      collectorStats: collected.stats,
      durationMs: Date.now() - started
    }));

    return {
      success: true,
      ai_curated: Boolean(curated),
      news_count: news.length,
      event_count: curation.events.length,
      message_count: delivery.messageCount
    };
  } catch (error) {
    console.error('[DailyNewsJobError]', error.message, 'durationMs=' + (Date.now() - started));

    if (lockToken) {
      const definitelyRejectedBeforeAnyDelivery =
        deliveryStarted && error.deliveryOutcome === 'rejected' && sentMessageCount === 0;

      if (sentStatePersisted) {
        // The digest was acknowledged and its sent state persisted; keep that state.
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
        // A definite rejection before the first acknowledged message is safe to retry.
        try {
          await store.releaseDailyRun(dateKey, lockToken);
        } catch (releaseError) {
          console.error('[LockReleaseError]', releaseError.message);
        }
      }
    }

    throw error;
  }
}

module.exports = { runDailyNewsJob };
