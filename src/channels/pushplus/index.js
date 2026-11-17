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
  let acceptedCount = 0;
  for (let index = 0; index < messages.length; index += 1) {
    // Submit chunks separately to stay within PushPlus content limits.
    await sendPushPlus({
      title: '每日智能早报 · ' + digest.dateHeader +
        (messages.length > 1 ? ' (' + (index + 1) + '/' + messages.length + ')' : ''),
      content: messages[index]
    });

    acceptedCount += 1;
    // This confirms PushPlus accepted the request, not that WeChat displayed it.
    if (onSent) await onSent(acceptedCount);
  }

  return { messageCount: acceptedCount };
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
