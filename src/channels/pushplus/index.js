const { buildMessages } = require('../telegram/formatter');
const { validateConfig, sendPushPlus } = require('./client');

function groupMessages(messages, maxLength = 18000) {
  const groups = [];
  let current = '';

  for (const message of messages) {
    const next = current ? current + '\n\n' + message : message;
    if (next.length > maxLength && current) {
      groups.push(current);
      current = message;
    } else {
      current = next;
    }
  }

  if (current) groups.push(current);
  return groups;
}

async function deliver(digest, { onSent } = {}) {
  let messages;
  try {
    messages = buildMessages(digest);
    if (!messages.length) throw new Error('No PushPlus messages generated');
    messages = groupMessages(messages);
  } catch (error) {
    error.deliveryOutcome = 'not_started';
    throw error;
  }

  validateConfig();
  let acceptedCount = 0;
  for (let index = 0; index < messages.length; index += 1) {
    // Keep a safety margin below PushPlus's documented content length limit.
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
