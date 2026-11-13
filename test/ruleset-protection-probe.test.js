import test from 'node:test';
import assert from 'node:assert/strict';

test('intentional failure to verify required status check', () => {
  assert.equal(1, 2, 'This failure is intentional and only verifies branch protection.');
});
