const { collectAll } = require('../collectors');
const { prepareNews } = require('../services/news-pipeline');
const { curateNews, fallbackCuration } = require('../services/ai-curator');
const { fetchHeaderBar } = require('../services/header');
const { beijingHeader, beijingDate } = require('../utils/date');
const store = require('../services/state-store');
const telegram = require('../channels/telegram');
const { assertChannel, assertDeliveryResult } = require('../channels/contract');

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
    channels: null,
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
    store: stateStore
  } = deps;
  const channels = (deps.channels || [deps.telegram]).map(assertChannel);
  const channelNames = new Set(channels.map(channel => channel.name));
  if (channelNames.size !== channels.length) throw new Error('Channel names must be unique');

  async function runDailyNewsJob() {
    const started = Date.now();
    const dateKey = getDateKey();
    let lockToken = null;
    let deliveryStarted = false;
    let sentMessageCount = 0;
    let sentStatePersisted = false;
    const channelStates = Object.fromEntries(channels.map(channel => [
      channel.name,
      { status: 'pending', sentMessageCount: 0 }
    ]));
    const channelSentCounts = Object.fromEntries(channels.map(channel => [channel.name, 0]));

    async function persistProgress(status) {
      await stateStore.updateDailyRun(dateKey, lockToken, {
        status,
        sentMessageCount,
        channelStates: { ...channelStates }
      });
    }

    try {
      lockToken = await stateStore.claimDailyRun(dateKey);
      if (!lockToken) {
        const error = new Error('Daily run already claimed or delivered');
        error.statusCode = 409;
        throw error;
      }

      await persistProgress('processing');

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

      // Validate every destination before the first external delivery starts.
      channels.forEach(channel => channel.validateConfig());

      for (const channel of channels) {
        channelStates[channel.name] = { status: 'sending', sentMessageCount: 0 };
        await persistProgress('sending');
        deliveryStarted = true;

        const result = assertDeliveryResult(channel, await channel.deliver(digest, {
          onSent: async count => {
            channelSentCounts[channel.name] = count;
            channelStates[channel.name] = { status: 'sending', sentMessageCount: count };
            sentMessageCount = Object.values(channelSentCounts).reduce((sum, value) => sum + value, 0);
            await persistProgress('sending');
          }
        }));

        channelStates[channel.name] = {
          status: 'sent',
          sentMessageCount: result.messageCount
        };
        channelSentCounts[channel.name] = result.messageCount;
        sentMessageCount = Object.values(channelSentCounts).reduce((sum, value) => sum + value, 0);
        await persistProgress('sending');
      }

      await persistProgress('sent');
      sentStatePersisted = true;

      // History persistence must not cause an already delivered digest to be sent again.
      await stateStore.saveRecentEvents(curation.events, dateKey);
      await stateStore.completeDailyRun(dateKey, lockToken);

      console.log(JSON.stringify({
        event: 'daily_news_completed',
        date: dateKey,
        newsCount: news.length,
        eventCount: curation.events.length,
        messageCount: sentMessageCount,
        channels: channelStates,
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
        message_count: sentMessageCount,
        channel_results: channelStates
      };
    } catch (error) {
      console.error('[DailyNewsJobError]', error.message, 'durationMs=' + (Date.now() - started));

      if (lockToken) {
        const definitelyRejectedBeforeAnyDelivery =
          deliveryStarted && error.deliveryOutcome === 'rejected' && sentMessageCount === 0;

        if (sentStatePersisted) {
          // All channels acknowledged delivery; preserve sent state if history persistence fails.
        } else if (deliveryStarted && !definitelyRejectedBeforeAnyDelivery) {
          const activeChannel = channels.find(channel => channelStates[channel.name].status === 'sending');
          if (activeChannel) {
            channelStates[activeChannel.name] = {
              status: error.deliveryOutcome === 'rejected' ? 'rejected' : 'delivery_unknown',
              sentMessageCount: channelSentCounts[activeChannel.name]
            };
          }
          try {
            await stateStore.updateDailyRun(dateKey, lockToken, {
              status: 'delivery_unknown',
              sentMessageCount,
              channelStates: { ...channelStates },
              error: 'Delivery or post-delivery persistence failed'
            });
          } catch (stateError) {
            console.error('[DeliveryStateError]', stateError.message);
          }
        } else {
          // A definite rejection before any acknowledged delivery is retryable.
          const rejectedChannel = channels.find(channel => channelStates[channel.name].status === 'sending');
          if (rejectedChannel && error.deliveryOutcome === 'rejected') {
            channelStates[rejectedChannel.name] = {
              status: 'rejected',
              sentMessageCount: 0
            };
            try {
              await stateStore.updateDailyRun(dateKey, lockToken, {
                status: 'rejected',
                sentMessageCount: 0,
                channelStates: { ...channelStates }
              });
            } catch (stateError) {
              console.error('[DeliveryStateError]', stateError.message);
            }
          }
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
