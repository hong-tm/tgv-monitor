'use strict';

// §4.1 state-ownership semantics: subscriptions lives only in src/store.js behind
// get/set accessors (never cloned), sessionCache is one stable Map instance.
// These lock the two properties the module split relies on.
const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../src/store.js');

test('getSubscriptions returns the live array (no clone); setSubscriptions replaces it', () => {
  const original = store.getSubscriptions();

  // get() must hand back the same reference it holds.
  assert.equal(store.getSubscriptions(), original, 'getSubscriptions must not clone');

  // set() must replace the held reference, and a previously captured reference
  // must NOT observe the replacement (this is why no module may cache it).
  const replacement = [];
  store.setSubscriptions(replacement);
  assert.equal(store.getSubscriptions(), replacement, 'setSubscriptions must assign, not clone');
  assert.notEqual(store.getSubscriptions(), original, 'stale reference must diverge after set');

  store.setSubscriptions(original);
  assert.equal(store.getSubscriptions(), original, 'restore original reference');
});

test('in-place mutation through getSubscriptions is visible to later getSubscriptions calls', () => {
  const original = store.getSubscriptions();
  const before = original.length;

  store.getSubscriptions().push({ sessionId: '__store_test__' });
  assert.equal(store.getSubscriptions().length, before + 1, 'push through get() must persist');

  const idx = store.getSubscriptions().findIndex((s) => s.sessionId === '__store_test__');
  assert.ok(idx >= 0, 'pushed entry must be found');
  store.getSubscriptions().splice(idx, 1);
  assert.equal(store.getSubscriptions().length, before, 'splice through get() must persist');

  store.setSubscriptions(original);
});

test('sessionCache is a single stable Map instance across requires', () => {
  assert.ok(store.sessionCache instanceof Map, 'sessionCache must be a Map');

  const again = require('../src/store.js');
  assert.equal(again.sessionCache, store.sessionCache, 'sessionCache identity must be stable');

  store.sessionCache.set('__store_test_key__', { ok: true });
  assert.deepEqual(again.sessionCache.get('__store_test_key__'), { ok: true });
  store.sessionCache.delete('__store_test_key__');
});
