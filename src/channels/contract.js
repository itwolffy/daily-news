function assertChannel(channel) {
  if (!channel || typeof channel.name !== 'string' || !channel.name.trim()) {
    throw new TypeError('Channel must provide a non-empty name');
  }
  if (typeof channel.validateConfig !== 'function' || typeof channel.deliver !== 'function') {
    throw new TypeError('Channel "' + channel.name + '" must implement validateConfig() and deliver()');
  }
  return channel;
}

function assertDeliveryResult(channel, result) {
  if (!result || !Number.isInteger(result.messageCount) || result.messageCount < 0) {
    throw new TypeError('Channel "' + channel.name + '" must return { messageCount: non-negative integer }');
  }
  return result;
}

module.exports = { assertChannel, assertDeliveryResult };
