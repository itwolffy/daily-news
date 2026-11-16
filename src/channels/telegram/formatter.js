// Telegram-specific presentation. The renderer owns HTML escaping, safe links and chunking.
const { buildMessages } = require('../../renderers/telegram');

function format(digest) {
  return buildMessages(digest);
}

module.exports = { format };
