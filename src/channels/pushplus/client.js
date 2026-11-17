const axios = require('axios');

const API_URL = 'https://www.pushplus.plus/send';

function credentials() {
  const token = (process.env.PUSHPLUS_TOKEN || '').trim();
  if (!token) throw new Error('PushPlus token is not configured');
  return { token };
}

function validateConfig() {
  credentials();
}

function pushplusError(message, deliveryOutcome) {
  const error = new Error(message);
  error.deliveryOutcome = deliveryOutcome;
  return error;
}

async function sendPushPlus({ title, content }) {
  const { token } = credentials();
  let response;

  try {
    response = await axios.post(API_URL, {
      token,
      title,
      content,
      template: 'html',
      channel: 'wechat'
    }, {
      timeout: 12000,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const status = error.response && error.response.status;
    if (status >= 400 && status < 500) {
      throw pushplusError('PushPlus rejected the request (HTTP ' + status + ')', 'rejected');
    }
    // A timeout or server error may happen after PushPlus accepted the request.
    throw pushplusError('PushPlus request outcome is unknown', 'unknown');
  }

  if (!response.data || Number(response.data.code) !== 200) {
    throw pushplusError(
      'PushPlus rejected the request: ' + String(response.data && response.data.msg || 'invalid response'),
      'rejected'
    );
  }

  return response.data;
}

module.exports = { validateConfig, sendPushPlus };
