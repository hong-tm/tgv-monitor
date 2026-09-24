'use strict';

// §4.1 state-ownership semantics: subscriptions lives only in src/store.js behind
// get/set accessors (never cloned), sessionCache is one stable Map instance.
// These lock the two properties the module split relies on.
const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../src/store.js');
const fs = require('node:fs');

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

test('upsertSubscription creates a new entry in canonical key order', (t) => {
  const initialCopy = store.getSubscriptions();
  t.after(() => store.setSubscriptions(initialCopy));

  store.setSubscriptions([]);
  t.mock.method(fs, 'writeFileSync', () => {});
  const returned = store.upsertSubscription('VIV', '157699', 'Spider Man', '20:30');

  // 新增项必须就是活动数组里的那个对象，不能是副本
  assert.equal(store.getSubscriptions().at(-1), returned, 'returned entry must be the live array element');
  assert.deepEqual(returned, {
    sessionId: '157699',
    cinemaId: 'VIV',
    movieTitle: 'Spider Man',
    showTime: '20:30',
    areaCategory: '0000000009',
    targetCodes: [],
    targetDetails: {},
    alerted: false,
    failCount: 0
  });
  // 键序锁定 subscriptions.json 的序列化字节
  assert.equal(
    Object.keys(returned).join(','),
    'sessionId,cinemaId,movieTitle,showTime,areaCategory,targetCodes,targetDetails,alerted,failCount'
  );
});

test('upsertSubscription keys on the (sessionId, cinemaId) pair', (t) => {
  const initialCopy = store.getSubscriptions();
  t.after(() => store.setSubscriptions(initialCopy));

  store.setSubscriptions([]);
  store.upsertSubscription('VIV', '157699', 'Spider Man', '20:30');
  assert.equal(store.getSubscriptions().length, 1, 'first upsert creates one entry');

  store.upsertSubscription('OTHER', '157699', 'Spider Man', '20:30');
  assert.equal(store.getSubscriptions().length, 2, 'same session at a different cinema is a new entry');

  store.upsertSubscription('VIV', '157699', 'Spider Man', '21:00');
  assert.equal(store.getSubscriptions().length, 2, 'same pair matches the existing entry');
});

test('upsertSubscription refreshes an existing entry without resetting state or persisting', (t) => {
  const initialCopy = store.getSubscriptions();
  t.after(() => store.setSubscriptions(initialCopy));

  store.setSubscriptions([{
    sessionId: '157699',
    cinemaId: 'VIV',
    movieTitle: 'OLD',
    showTime: '01:00',
    areaCategory: '0000000009',
    targetCodes: ['5785'],
    targetDetails: {},
    alerted: true,
    failCount: 3
  }]);
  const before = store.getSubscriptions()[0];
  t.mock.method(fs, 'writeFileSync', () => {});
  const returned = store.upsertSubscription('VIV', '157699', 'NEW', '02:00');

  assert.equal(returned, before, 'must return the same object identity');
  assert.equal(returned.movieTitle, 'NEW');
  assert.equal(returned.showTime, '02:00');
  assert.equal(store.getSubscriptions().length, 1, 'update must not append');
  assert.deepEqual(returned.targetCodes, ['5785'], 'targetCodes must survive the update');
  assert.equal(returned.alerted, true, 'alerted must survive the update');
  assert.equal(returned.failCount, 3, 'failCount must survive the update');

  // 只改内存：调用方（handlers 的 sub 分支）自行决定何时落盘
  assert.equal(fs.writeFileSync.mock.callCount(), 0, 'update must not persist');
  store.upsertSubscription('VIV', '999999', 'Fresh', '10:00');
  assert.equal(fs.writeFileSync.mock.callCount(), 0, 'create must not persist either');
});
