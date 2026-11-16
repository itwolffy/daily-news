const axios = require('axios');

function credentials() {
  const token = (process.env.TG_BOT_TOKEN || '').trim();
  const chat = (process.env.TG_CHAT_ID || '').trim();
  if (!token || !chat) throw new Error('Telegram credentials are not configured');
  return { token, chat };
}

function validateConfig() {
  credentials();
}

function telegramError(message, deliveryOutcome) {
  const error = new Error(message);
  error.deliveryOutcome = deliveryOutcome;
  return error;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegram(messages, onSent = async () => {}) {
  const { token, chat } = credentials();
  const path = token.startsWith('bot') ? token : 'bot' + token;

  for (let index = 0; index < messages.length; index += 1) {
    let response;
    let attempt = 0;

    while (true) {
      try {
        response = await axios.post(
          'https://api.telegram.org/' + path + '/sendMessage',
          {
            chat_id: chat,
            text: messages[index],
            parse_mode: 'HTML',
            disable_web_page_preview: true
          },
          { timeout: 12000 }
        );
        break;
      } catch (error) {
        const status = error.response && error.response.status;
        if (status === 429 && attempt < 2) {
          const retryAfter = Number(
            error.response.data &&
            error.response.data.parameters &&
            error.response.data.parameters.retry_after
          );
          const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 1000;

          // Keep retries bounded so a rate limit cannot consume the entire invocation.
          if (delayMs <= 10000) {
            attempt += 1;
            await wait(delayMs);
            continue;
          }
        }

        if (status >= 400 && status < 500) {
          throw telegramError('Telegram rejected a message (HTTP ' + status + ')', 'rejected');
        }
        // Network and server errors may occur after Telegram accepted the message.
        throw telegramError('Telegram delivery outcome is unknown', 'unknown');
      }
    }

    if (!response.data || response.data.ok !== true) {
      throw telegramError('Telegram API rejected a message', 'rejected');
    }

    // Persist each acknowledged message before attempting the next one.
    await onSent(index + 1);
  }
}

module.exports = { validateConfig, sendTelegram };
