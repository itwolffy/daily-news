const { collectAll } = require('../collectors');
const { prepareNews } = require('../services/news-pipeline');
const { curateNews, fallbackCuration } = require('../services/ai-curator');
const { fetchHeaderBar } = require('../services/header');
const { beijingHeader, beijingDate } = require('../utils/date');
const store = require('../services/state-store');
const telegram = require('../channels/telegram');
const pushplus = require('../channels/pushplus');
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
    pushplus,
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
  const defaultChannels = [deps.telegram];
  if (deps.pushplus.isConfigured()) defaultChannels.push(deps.pushplus);
  const channels = (deps.channels || defaultChannels).map(assertChannel);
  const channelNames = new Set(channels.map(channel => channel.name));
  if (channelNames.size !== channels.length) throw new Error('Channel names must be unique');

  async function runDailyNewsJob() {
    const started = Date.now();
    const dateKey = getDateKey();
    let lockToken = null;
    let deliveryStarted = false;
    let allChannelsDelivered = false;
    let sentMessageCount = 0;
    let sentStatePersisted = false;
    let curationEvents = [];
    const channelStates = Object.fromEntries(channels.map(channel => [
      channel.name,
      { status: 'pending', sentMessageCount: 0 }
    ]));
    const channelSentCounts = Object.fromEntries(channels.map(channel => [channel.name, 0]));

    async function persistProgress(status, extra = {}) {
      await stateStore.updateDailyRun(dateKey, lockToken, {
        status,
        sentMessageCount,
        channelStates: { ...channelStates },
        ...extra
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
      curationEvents = curation.events;
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

        let lastReportedCount = 0;
        const result = assertDeliveryResult(channel, await channel.deliver(digest, {
          onSent: async count => {
            if (!Number.isInteger(count) || count < lastReportedCount || count < 0) {
              throw new Error('Channel "' + channel.name + '" reported invalid delivery progress');
            }
            lastReportedCount = count;
            channelSentCounts[channel.name] = count;
            channelStates[channel.name] = { status: 'sending', sentMessageCount: count };
            sentMessageCount = Object.values(channelSentCounts).reduce((sum, value) => sum + value, 0);
            await persistProgress('sending');
          }
        }));

        if (result.messageCount < lastReportedCount) {
          throw new Error('Channel "' + channel.name + '" returned fewer messages than it acknowledged');
        }
        channelStates[channel.name] = {
          status: 'sent',
          sentMessageCount: result.messageCount
        };
        channelSentCounts[channel.name] = result.messageCount;
        sentMessageCount = Object.values(channelSentCounts).reduce((sum, value) => sum + value, 0);
        await persistProgress('sending');
      }

      // From this point onward delivery is confirmed. Persistence failures must
      // never downgrade the delivery outcome or make the digest eligible to resend.
      allChannelsDelivered = true;
      await persistProgress('sent', {
        historyStatus: 'pending',
        historyEvents: curationEvents
      });
      sentStatePersisted = true;

      await stateStore.saveRecentEvents(curationEvents, dateKey);
      await stateStore.updateDailyRun(dateKey, lockToken, {
        historyStatus: 'saved'
      });
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
        const activeChannel = channels.find(channel => channelStates[channel.name].status === 'sending');
        const activeChannelCount = activeChannel ? channelSentCounts[activeChannel.name] : 0;
        const definitelyRejectedBeforeAnyDelivery =
          deliveryStarted &&
          error.deliveryOutcome === 'rejected' &&
          activeChannelCount === 0 &&
          sentMessageCount === 0;

        if (allChannelsDelivered) {
          // A failed sent-state write may have succeeded remotely despite a lost
          // response. Repeating this idempotent state write is safe; keep the lock
          // regardless if persistence remains unavailable.
          if (!sentStatePersisted) {
            try {
              await persistProgress('sent', {
                historyStatus: 'pending',
                historyEvents: curationEvents
              });
              sentStatePersisted = true;
            } catch (stateError) {
              console.error('[DeliveryStateError]', stateError.message);
            }
          }
          // If history persistence failed, the sent record retains the pending
          // events for diagnosis/recovery. Never release the delivery lock here.
        } else if (sentStatePersisted) {
          // All channels were sent; a history write or completion write failed.
          // Keep the sent state and lock to prevent replay.
        } else if (error.deliveryOutcome === 'not_started') {
          // Local preparation (for example Telegram formatting) failed before
          // any external request. Persist a retryable state before releasing.
          if (activeChannel) {
            channelStates[activeChannel.name] = {
              status: 'pending',
              sentMessageCount: 0
            };
          }
          let failedStatePersisted = false;
          try {
            await stateStore.updateDailyRun(dateKey, lockToken, {
              status: 'failed_before_delivery',
              sentMessageCount: 0,
              channelStates: { ...channelStates }
            });
            failedStatePersisted = true;
          } catch (stateError) {
            console.error('[DeliveryStateError]', stateError.message);
          }
          if (failedStatePersisted) {
            try {
              await stateStore.releaseDailyRun(dateKey, lockToken);
            } catch (releaseError) {
              console.error('[LockReleaseError]', releaseError.message);
            }
          }
        } else if (deliveryStarted && !definitelyRejectedBeforeAnyDelivery) {
          if (activeChannel) {
            channelStates[activeChannel.name] = {
              status: activeChannelCount > 0 ? 'delivery_unknown' :
                (error.deliveryOutcome === 'rejected' ? 'rejected' : 'delivery_unknown'),
              sentMessageCount: activeChannelCount
            };
          }
          try {
            await stateStore.updateDailyRun(dateKey, lockToken, {
              status: 'delivery_unknown',
              sentMessageCount,
              channelStates: { ...channelStates },
              error: 'Delivery outcome is ambiguous or a delivery checkpoint could not be persisted'
            });
          } catch (stateError) {
            console.error('[DeliveryStateError]', stateError.message);
          }
        } else if (definitelyRejectedBeforeAnyDelivery) {
          if (activeChannel) {
            channelStates[activeChannel.name] = {
              status: 'rejected',
              sentMessageCount: 0
            };
          }
          let rejectedStatePersisted = false;
          try {
            await stateStore.updateDailyRun(dateKey, lockToken, {
              status: 'rejected',
              sentMessageCount: 0,
              channelStates: { ...channelStates }
            });
            rejectedStatePersisted = true;
          } catch (stateError) {
            console.error('[DeliveryStateError]', stateError.message);
          }

          // Release only after the retryable rejection is durably recorded.
          if (rejectedStatePersisted) {
            try {
              await stateStore.releaseDailyRun(dateKey, lockToken);
            } catch (releaseError) {
              console.error('[LockReleaseError]', releaseError.message);
            }
          }
        } else {
          // Failures before any delivery starts are safe to retry.
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
