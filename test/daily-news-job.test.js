const test = require('node:test');
const assert = require('node:assert/strict');
const { createDailyNewsJob } = require('../src/jobs/daily-news-job');

function createDependencies(overrides = {}) {
  const updates = [];
  const calls = [];
  const store = {
    claimDailyRun: async () => 'lock-token',
    updateDailyRun: async (_date, _token, state) => updates.push(state),
    getRecentEvents: async () => [],
    saveRecentEvents: async () => calls.push('saveRecentEvents'),
    completeDailyRun: async () => calls.push('completeDailyRun'),
    releaseDailyRun: async () => calls.push('releaseDailyRun'),
    redisEnabled: () => true
  };
  const telegram = {
    name: 'telegram',
    validateConfig: () => calls.push('validateConfig'),
    deliver: async (_digest, { onSent }) => {
      await onSent(1);
      return { messageCount: 1 };
    }
  };
  const deps = {
    collectAll: async () => ({
      items: [{ title: 'raw item' }],
      stats: [{ source: 'test', count: 1, ok: true }]
    }),
    prepareNews: items => items,
    curateNews: async () => ({ events: [{ id: 'event-1' }] }),
    fallbackCuration: () => ({ events: [] }),
    fetchHeaderBar: async () => '',
    beijingHeader: () => '2026-11-16',
    beijingDate: () => '2026-11-16',
    store,
    telegram,
    ...overrides
  };
  return { deps, updates, calls };
}

test('daily job completes after the channel acknowledges delivery', async () => {
  const { deps, updates, calls } = createDependencies();
  const run = createDailyNewsJob(deps);

  const result = await run();

  assert.equal(result.success, true);
  assert.equal(result.message_count, 1);
  assert.equal(result.channel_results.telegram.status, 'sent');
  assert.deepEqual(updates.map(x => x.status), ['processing', 'sending', 'sending', 'sending', 'sent', undefined]);
  assert.deepEqual(calls, ['validateConfig', 'saveRecentEvents', 'completeDailyRun']);
});

test('daily job preserves the lock when delivery outcome is unknown', async () => {
  const { deps, updates, calls } = createDependencies({
    telegram: {
      name: 'telegram',
      validateConfig: () => {},
      deliver: async () => {
        const error = new Error('network timeout');
        error.deliveryOutcome = 'unknown';
        throw error;
      }
    }
  });
  const run = createDailyNewsJob(deps);

  await assert.rejects(run(), /network timeout/);

  assert.equal(updates.at(-1).status, 'delivery_unknown');
  assert.equal(calls.includes('releaseDailyRun'), false);
});

test('daily job reports a conflict when another run already owns the daily claim', async () => {
  const { deps, updates } = createDependencies({
    store: {
      claimDailyRun: async () => null,
      updateDailyRun: async (_date, _token, state) => updates.push(state)
    }
  });
  const run = createDailyNewsJob(deps);

  await assert.rejects(run(), error => error.statusCode === 409);
  assert.equal(updates.length, 0);
});

test('daily job records channel-level delivery state and continues to the next channel', async () => {
  const { deps, updates } = createDependencies({
    channels: [
      {
        name: 'telegram',
        validateConfig: () => {},
        deliver: async (_digest, { onSent }) => {
          await onSent(1);
          return { messageCount: 1 };
        }
      },
      {
        name: 'secondary',
        validateConfig: () => {},
        deliver: async (_digest, { onSent }) => {
          await onSent(2);
          return { messageCount: 2 };
        }
      }
    ]
  });
  const result = await createDailyNewsJob(deps)();
  assert.equal(result.message_count, 3);
  assert.equal(result.channel_results.telegram.status, 'sent');
  assert.equal(result.channel_results.secondary.status, 'sent');
  assert.ok(updates.some(state => state.channelStates &&
    state.channelStates.telegram.status === 'sent' &&
    state.channelStates.secondary.status === 'sending'));
});

test('definite rejection is recorded per channel and releases the run for retry', async () => {
  const { deps, updates, calls } = createDependencies({
    telegram: {
      name: 'telegram',
      validateConfig: () => {},
      deliver: async () => {
        const error = new Error('rejected');
        error.deliveryOutcome = 'rejected';
        throw error;
      }
    }
  });
  await assert.rejects(createDailyNewsJob(deps)(), /rejected/);
  assert.equal(updates.at(-1).status, 'rejected');
  assert.equal(updates.at(-1).channelStates.telegram.status, 'rejected');
  assert.ok(calls.includes('releaseDailyRun'));
});


test('partial delivery followed by a definite rejection is not marked fully rejected', async () => {
  const { deps, updates, calls } = createDependencies({
    telegram: {
      name: 'telegram',
      validateConfig: () => {},
      deliver: async (_digest, { onSent }) => {
        await onSent(1);
        const error = new Error('second message rejected');
        error.deliveryOutcome = 'rejected';
        throw error;
      }
    }
  });

  await assert.rejects(createDailyNewsJob(deps)(), /second message rejected/);

  const finalState = updates.at(-1);
  assert.equal(finalState.status, 'delivery_unknown');
  assert.equal(finalState.channelStates.telegram.status, 'delivery_unknown');
  assert.equal(finalState.channelStates.telegram.sentMessageCount, 1);
  assert.equal(calls.includes('releaseDailyRun'), false);
});

test('a rejected state write failure must not release the daily lock', async () => {
  const { deps, updates, calls } = createDependencies({
    telegram: {
      name: 'telegram',
      validateConfig: () => {},
      deliver: async () => {
        const error = new Error('rejected');
        error.deliveryOutcome = 'rejected';
        throw error;
      }
    }
  });
  const originalUpdate = deps.store.updateDailyRun;
  deps.store.updateDailyRun = async (date, token, state) => {
    if (state.status === 'rejected') throw new Error('Redis unavailable');
    return originalUpdate(date, token, state);
  };

  await assert.rejects(createDailyNewsJob(deps)(), /rejected/);

  assert.equal(updates.some(state => state.status === 'rejected'), false);
  assert.equal(calls.includes('releaseDailyRun'), false);
});

test('history persistence failure preserves sent state and pending history payload', async () => {
  const { deps, updates, calls } = createDependencies();
  deps.store.saveRecentEvents = async () => {
    calls.push('saveRecentEvents');
    throw new Error('history write failed');
  };

  await assert.rejects(createDailyNewsJob(deps)(), /history write failed/);

  const sentState = updates.find(state => state.status === 'sent');
  assert.ok(sentState);
  assert.equal(sentState.historyStatus, 'pending');
  assert.deepEqual(sentState.historyEvents, [{ id: 'event-1' }]);
  assert.equal(updates.some(state => state.status === 'delivery_unknown'), false);
  assert.equal(calls.includes('releaseDailyRun'), false);
});

test('failure to persist sent state is retried as a state write, not downgraded to delivery_unknown', async () => {
  const { deps, updates, calls } = createDependencies();
  const originalUpdate = deps.store.updateDailyRun;
  let sentWriteAttempts = 0;
  deps.store.updateDailyRun = async (date, token, state) => {
    if (state.status === 'sent' && ++sentWriteAttempts === 1) {
      throw new Error('Redis response lost');
    }
    return originalUpdate(date, token, state);
  };

  await assert.rejects(createDailyNewsJob(deps)(), /Redis response lost/);

  assert.equal(sentWriteAttempts, 2);
  assert.equal(updates.at(-1).status, 'sent');
  assert.equal(updates.some(state => state.status === 'delivery_unknown'), false);
  assert.equal(calls.includes('releaseDailyRun'), false);
});


test('a later channel rejection after an earlier channel succeeded keeps the whole run blocked', async () => {
  const { deps, updates, calls } = createDependencies({
    channels: [
      {
        name: 'telegram',
        validateConfig: () => {},
        deliver: async (_digest, { onSent }) => {
          await onSent(1);
          return { messageCount: 1 };
        }
      },
      {
        name: 'secondary',
        validateConfig: () => {},
        deliver: async () => {
          const error = new Error('secondary rejected');
          error.deliveryOutcome = 'rejected';
          throw error;
        }
      }
    ]
  });

  await assert.rejects(createDailyNewsJob(deps)(), /secondary rejected/);

  const finalState = updates.at(-1);
  assert.equal(finalState.status, 'delivery_unknown');
  assert.equal(finalState.channelStates.telegram.status, 'sent');
  assert.equal(finalState.channelStates.secondary.status, 'rejected');
  assert.equal(finalState.sentMessageCount, 1);
  assert.equal(calls.includes('releaseDailyRun'), false);
});
