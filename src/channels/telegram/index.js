const { format } = require('./formatter');
const { validateConfig, sendTelegram } = require('./client');

async function deliver(digest, { onSent } = {}) {
  const messages = format(digest);
  if (!messages.length) throw new Error('No Telegram messages generated');

  validateConfig();
  await sendTelegram(messages, onSent);

  return { messageCount: messages.length };
}

module.exports = {
  name: 'telegram',
  deliver,
  validateConfig
};
