const { collectAll } = require('../collectors');
const { prepareNews } = require('../services/news-pipeline');
const { curateNews, fallbackCuration } = require('../services/ai-curator');
const { fetchHeaderBar } = require('../services/header');
const { beijingHeader, beijingDate } = require('../utils/date');
const store = require('../services/state-store');
const telegram = require('../channels/telegram');

function createDailyNewsJob(dependencies = {}) {
  const deps = {
    collectAll,
    prepareNews,
    curateNews,
    fallbackCuration,
    fetchHeaderBar,
    beijingHeader,
    beijingDate,
    store,
    telegram,
    ...dependencies
  };
  const {
    collectAll: collect,
    prepareNews: prepare,
    curateNews: curate,
    fallbackCuration: fallback,
    fetchHeaderBar: fetchHeader,
    beijingHeader: getDateHeader,
    beijingDate: getDateKey,
    store: stateStore,
    telegram: channel
  } = deps;

  async function runDailyNewsJob() {

  const started = Date.now();
  const dateKey = getDateKey();
  let lockToken = null;
  let deliveryStarted = false;
  let sentMessageCount = 0;
  let sentStatePersisted = false;

  try {
    lockToken = await stateStore.claimDailyRun(dateKey);
    if (!lockToken) {
      const error = new Error('Daily run already claimed or delivered');
      error.statusCode = 409;
      throw error;
    }

    await stateStore.updateDailyRun(dateKey, lockToken, {
      status: 'processing',
      sentMessageCount: 0
    });

    const [collected, headerBar, recent] = await Promise.all([
      collect(),
      fetchHeader().catch(error => {
        console.error('[HeaderError]', error.message);
        return '';
      }),
      stateStore.getRecentEvents()
    ]);

    const news = prepare(collected.items);
    if (!news.length) throw new Error('No valid news items collected');

    const curated = await curate(news, recent);
    const curation = curated || fallback(news);
    const digest = {
      dateHeader: getDateHeader(),
      headerBar,
      curation
    };

    // Validate local channel configuration before entering the ambiguous-delivery state.
    channel.validateConfig();

    await stateStore.updateDailyRun(dateKey, lockToken, {
      status: 'sending',
      sentMessageCount: 0
    });
    deliveryStarted = true;

    const delivery = await channel.deliver(digest, {
      onSent: async count => {
        sentMessageCount = count;
        await stateStore.updateDailyRun(dateKey, lockToken, {
          status: 'sending',
          sentMessageCount: count
        });
      }
    });

    await stateStore.updateDailyRun(dateKey, lockToken, {
      status: 'sent',
      sentMessageCount
    });
    sentStatePersisted = true;

    // History persistence must not cause an already delivered digest to be sent again.
    await stateStore.saveRecentEvents(curation.events, dateKey);
    await stateStore.completeDailyRun(dateKey, lockToken);

    console.log(JSON.stringify({
      event: 'daily_news_completed',
      date: dateKey,
      newsCount: news.length,
      eventCount: curation.events.length,
      messageCount: delivery.messageCount,
      aiCurated: Boolean(curated),
      redis: stateStore.redisEnabled(),
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
          await stateStore.updateDailyRun(dateKey, lockToken, {
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
          await stateStore.releaseDailyRun(dateKey, lockToken);
        } catch (releaseError) {
          console.error('[LockReleaseError]', releaseError.message);
        }
      }
    }

    throw error;
  }
  }

  return runDailyNewsJob;
}

const runDailyNewsJob = createDailyNewsJob();

module.exports = { createDailyNewsJob, runDailyNewsJob };
