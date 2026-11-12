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

  // Check the previous state and acquire the lock in one Redis transaction.
  // This prevents a failed state write from leaving an orphaned lock.
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
    // The Redis script may have executed even if its HTTP response was lost.
    // Best-effort compare-and-delete avoids leaving an unowned lock behind.
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
  const state = { ...progress, updatedAt: new Date().toISOString() };
  if (!config()) {
    if (locks.get(key.lock) !== token) throw new Error('Daily run lock ownership lost');
    runStates.set(key.state, state);
    return true;
  }
  const script = [
    "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end",
    "redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])",
    'return 1'
  ].join('\n');
  const result = await command(['EVAL', script, '2', key.lock, key.state, token, JSON.stringify(state), '172800']);
  if (Number(result) !== 1) throw new Error('Daily run lock ownership lost');
  return true;
}

async function completeDailyRun(day, token) {
  const key = keys(day);
  const state = { status: 'completed', sentMessageCount: null, updatedAt: new Date().toISOString() };
  if (!config()) {
    if (locks.get(key.lock) !== token) throw new Error('Daily run lock ownership lost');
    runStates.set(key.state, state);
    locks.set(key.lock, 'done');
    return true;
  }
  const script = [
    "if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end",
    "redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])",
    "redis.call('SET', KEYS[1], 'done', 'EX', ARGV[3])",
    'return 1'
  ].join('\n');
  const result = await command(['EVAL', script, '2', key.lock, key.state, token, JSON.stringify(state), '172800']);
  if (Number(result) !== 1) throw new Error('Daily run lock ownership lost');
  return true;
}

async function releaseDailyRun(day, token) {
  const key = keys(day);
  if (!config()) {
    if (locks.get(key.lock) === token) {
      locks.delete(key.lock);
      runStates.delete(key.state);
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
  // Do not overwrite the history with a partial snapshot when the Redis read fails.
  const value = await command(['GET', 'daily-news:recent-events']);
  const previous = value ? JSON.parse(value) : [];
  if (!Array.isArray(previous)) throw new Error('Stored recent-event history is not an array');
  const next = events.map(event => ({
    title: event.title, category: event.category, summary: event.summary, date: day
  })).concat(previous).slice(0, 80);
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
