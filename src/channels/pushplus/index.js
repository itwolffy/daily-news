const { buildMessages } = require('../telegram/formatter');
const { validateConfig, sendPushPlus } = require('./client');

async function deliver(digest, { onSent } = {}) {
  let messages;
  try {
    messages = buildMessages(digest);
    if (!messages.length) throw new Error('No PushPlus messages generated');
  } catch (error) {
    error.deliveryOutcome = 'not_started';
    throw error;
  }

  validateConfig();
  // PushPlus accepts one HTML body; keep the formatter's complete content blocks.
  await sendPushPlus({
    title: '每日智能早报 · ' + digest.dateHeader,
    content: messages.join('<hr/>')
  });

  // This confirms PushPlus accepted the request, not that WeChat displayed it.
  if (onSent) await onSent(1);
  return { messageCount: 1 };
}

function isConfigured() {
  return Boolean((process.env.PUSHPLUS_TOKEN || '').trim());
}

module.exports = {
  name: 'pushplus',
  deliver,
  validateConfig,
  isConfigured
};
