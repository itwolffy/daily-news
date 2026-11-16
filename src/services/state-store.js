const crypto = require('node:crypto');
const axios = require('axios');

const locks = new Map();
const runStates = new Map();

function config() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

async function command(args) {
  const c = config();
  if (!c) return null;
  const response = await axios.post(c.url, args, {
    timeout: 4000,
    headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }
  });
  if (response.data && response.data.error) throw new Error('Redis command failed: ' + response.data.error);
  return response.data && response.data.result;
}

function keys(day) {
  return {
    lock: 'daily-news:run:' + day,
    state: 'daily-news:run-state:' + day
  };
}

async function claimDailyRun(day) {
  const token = crypto.randomUUID();
  const key = keys(day);
  const initialState = {
    status: 'claimed',
    sentMessageCount: 0,
    updatedAt: new Date().toISOString()
  };

  if (!config()) {
    const state = runStates.get(key.state);
    if (locks.has(key.lock) || (state && ['sending', 'delivery_unknown', 'sent', 'completed'].includes(state.status))) return null;
    locks.set(key.lock, token);
    runStates.set(key.state, initialState);
    return token;
  }

  const script = [
    "local previous = redis.call('GET', KEYS[2])",
    'if previous then',
    '  local ok, state = pcall(cjson.decode, previous)',
    '  if not ok then return 0 end',
    "  local status = state['status']",
    "  if status == 'sending' or status == 'delivery_unknown' or status == 'sent' or status == 'completed' then return 0 end",
    'end',
    "local acquired = redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2], 'NX')",
    "if not acquired then return 0 end",
    "redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[4])",
    'return 1'
  ].join('\n');
  let result;
  try {
    result = await command([
      'EVAL', script, '2', key.lock, key.state,
      token, '7200', JSON.stringify(initialState), '172800'
    ]);
  } catch (error) {
    try {
      await releaseDailyRun(day, token);
    } catch (releaseError) {
      console.error('[ClaimCleanupError]', releaseError.message);
    }
    throw error;
  }
  return Number(result) === 1 ? token : null;
}

async function updateDailyRun(day, token, progress) {
  const key = keys(day);
  if (!config()) {
    if (locks.get(key.lock) !== token) throw new Error('Daily run lock ownership lost');
    const previous = runStates.get(key.state) || {};
    runStates.set(key.state, {
      ...previous,
      ...progress,
      updatedAt: new Date().toISOString()
    });
    return true;
  }

  const script = [
    "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end",
    "local raw = redis.call('GET', KEYS[2])",
    'local state = {}',
    'if raw then',
    '  local ok, decoded = pcall(cjson.decode, raw)',
    '  if not ok then return -1 end',
    '  state = decoded',
    'end',
    'local patch = cjson.decode(ARGV[2])',
    'for key, value in pairs(patch) do state[key] = value end',
    'state.updatedAt = ARGV[3]',
    "redis.call('SET', KEYS[2], cjson.encode(state), 'EX', ARGV[4])",
    'return 1'
  ].join('\n');
  const result = Number(await command([
    'EVAL', script, '2', key.lock, key.state,
    token, JSON.stringify(progress), new Date().toISOString(), '172800'
  ]));
  if (result === -1) throw new Error('Daily run state contains invalid JSON');
  if (result !== 1) throw new Error('Daily run lock ownership lost');
  return true;
}

async function completeDailyRun(day, token) {
  const key = keys(day);
  if (!config()) {
    if (locks.get(key.lock) !== token) throw new Error('Daily run lock ownership lost');
    const previous = runStates.get(key.state) || {};
    runStates.set(key.state, {
      ...previous,
      status: 'completed',
      updatedAt: new Date().toISOString()
    });
    locks.set(key.lock, 'done');
    return true;
  }

  const script = [
    "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end",
    "local raw = redis.call('GET', KEYS[2])",
    'local state = {}',
    'if raw then',
    '  local ok, decoded = pcall(cjson.decode, raw)',
    '  if not ok then return -1 end',
    '  state = decoded',
    'end',
    "state.status = 'completed'",
    'state.updatedAt = ARGV[2]',
    "redis.call('SET', KEYS[2], cjson.encode(state), 'EX', ARGV[3])",
    "redis.call('SET', KEYS[1], 'done', 'EX', ARGV[3])",
    'return 1'
  ].join('\n');
  const result = Number(await command([
    'EVAL', script, '2', key.lock, key.state,
    token, new Date().toISOString(), '172800'
  ]));
  if (result === -1) throw new Error('Daily run state contains invalid JSON');
  if (result !== 1) throw new Error('Daily run lock ownership lost');
  return true;
}

async function releaseDailyRun(day, token) {
  const key = keys(day);
  if (!config()) {
    if (locks.get(key.lock) === token) {
      locks.delete(key.lock);
      // Preserve the rejected state: it is useful for diagnostics and remains
      // claimable because claimDailyRun does not block status "rejected".
      return true;
    }
    return false;
  }
  const script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
  return Number(await command(['EVAL', script, '1', key.lock, token])) === 1;
}

async function getRecentEvents() {
  if (!config()) return [];
  try {
    const value = await command(['GET', 'daily-news:recent-events']);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[StateStoreReadError]', error.message);
    return [];
  }
}

async function saveRecentEvents(events, day) {
  if (!config()) return;
  const value = await command(['GET', 'daily-news:recent-events']);
  const previous = value ? JSON.parse(value) : [];
  if (!Array.isArray(previous)) throw new Error('Stored recent-event history is not an array');

  // A retry after a lost Redis response must not append the same day's events twice.
  const withoutThisDay = previous.filter(event => event.date !== day);
  const next = events.map(event => ({
    title: event.title, category: event.category, summary: event.summary, date: day
  })).concat(withoutThisDay).slice(0, 80);
  await command(['SET', 'daily-news:recent-events', JSON.stringify(next), 'EX', 1209600]);
}

module.exports = {
  redisEnabled: () => Boolean(config()),
  claimDailyRun,
  updateDailyRun,
  completeDailyRun,
  releaseDailyRun,
  getRecentEvents,
  saveRecentEvents
};
