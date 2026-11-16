const { buildMessages } = require('./formatter');
const { validateConfig, sendTelegram } = require('./client');

async function deliver(digest, { onSent } = {}) {
  let messages;
  try {
    messages = buildMessages(digest);
    if (!messages.length) throw new Error('No Telegram messages generated');
  } catch (error) {
    // Formatting is local work; no Telegram request has been attempted.
    error.deliveryOutcome = 'not_started';
    throw error;
  }

  validateConfig();
  await sendTelegram(messages, onSent);

  return { messageCount: messages.length };
}

module.exports = {
  name: 'telegram',
  deliver,
  validateConfig
};
