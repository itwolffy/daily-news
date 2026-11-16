const test = require('node:test');
const assert = require('node:assert/strict');
const { assertChannel, assertDeliveryResult } = require('../src/channels/contract');
const telegram = require('../src/channels/telegram');

test('Telegram adapter conforms to the shared channel contract', () => {
  assert.equal(assertChannel(telegram), telegram);
  assert.equal(telegram.name, 'telegram');
});

test('channel contract rejects missing operations and malformed delivery results', () => {
  assert.throws(() => assertChannel({ name: 'incomplete' }), /validateConfig/);
  assert.throws(() => assertChannel({ validateConfig() {}, deliver() {} }), /name/);
  assert.throws(() => assertDeliveryResult({ name: 'test' }, { count: 1 }), /messageCount/);
  assert.throws(() => assertDeliveryResult({ name: 'test' }, { messageCount: -1 }), /messageCount/);
  assert.deepEqual(assertDeliveryResult({ name: 'test' }, { messageCount: 0 }), { messageCount: 0 });
});
