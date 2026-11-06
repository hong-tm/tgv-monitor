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

  // the created entry must be the live array element, not a copy
  assert.equal(store.getSubscriptions().at(-1), returned, 'returned entry must be the live array element');
  assert.deepEqual(returned, {
    sessionId: '157699',
    cinemaId: 'VIV',
    movieTitle: 'Spider Man',
    showTime: '20:30',
    areaCategory: '0000000009,0000000027,0000000005',
    targetCodes: [],
    targetDetails: {},
    alerted: false,
    alertedCodes: [],
    failCount: 0
  });
  // key order locks the serialized bytes of subscriptions.json
  assert.equal(
    Object.keys(returned).join(','),
    'sessionId,cinemaId,movieTitle,showTime,areaCategory,targetCodes,targetDetails,alerted,alertedCodes,failCount'
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
    areaCategory: '0000000009,0000000027,0000000005',
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

  // memory-only: callers (the sub branch in handlers) decide when to persist
  assert.equal(fs.writeFileSync.mock.callCount(), 0, 'update must not persist');
  store.upsertSubscription('VIV', '999999', 'Fresh', '10:00');
  assert.equal(fs.writeFileSync.mock.callCount(), 0, 'create must not persist either');
});

// --- atomic persistence -------------------------------------------------------

test('saveSubscriptions writes atomically: a sibling tmp file, then rename over the data file', (t) => {
  const calls = [];
  t.mock.method(fs, 'writeFileSync', (file, data) => calls.push(['write', file, data]));
  t.mock.method(fs, 'renameSync', (from, to) => calls.push(['rename', from, to]));
  const { DATA_FILE } = require('../src/config.js');

  store.saveSubscriptions([{ sessionId: '1' }]);

  assert.equal(calls.length, 2, 'exactly one write and one rename');
  assert.equal(calls[0][0], 'write');
  assert.ok(calls[0][1].startsWith(DATA_FILE + '.'), 'the write must target a sibling temp file, not the live file');
  assert.deepEqual(JSON.parse(calls[0][2]), [{ sessionId: '1' }]);
  assert.deepEqual(calls[1], ['rename', calls[0][1], DATA_FILE], 'the rename must replace the live file');
});

test('loadSubscriptions quarantines an unparseable data file instead of silently returning []', (t) => {
  const renames = [];
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => 'NOT JSON{{{');
  t.mock.method(fs, 'renameSync', (from, to) => renames.push([from, to]));
  const errors = [];
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')));
  const { DATA_FILE } = require('../src/config.js');

  assert.deepEqual(store.loadSubscriptions(), []);
  assert.equal(renames.length, 1, 'the corrupt file must be moved aside, not left to be clobbered');
  assert.equal(renames[0][0], DATA_FILE);
  assert.ok(/\.corrupt-\d+$/.test(renames[0][1]), 'quarantine name: ' + renames[0][1]);
  assert.equal(errors.length, 1, 'the corruption must be logged loudly');
});

test('loadSubscriptions quarantines a parseable but non-array body', (t) => {
  const renames = [];
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => '{"oops": true}');
  t.mock.method(fs, 'renameSync', (from, to) => renames.push([from, to]));
  t.mock.method(console, 'error', () => {});

  assert.deepEqual(store.loadSubscriptions(), []);
  assert.equal(renames.length, 1);
});

// --- placeholder metadata guard ------------------------------------------------

test('upsertSubscription does not clobber stored metadata with display placeholders', (t) => {
  const initialCopy = store.getSubscriptions();
  t.after(() => store.setSubscriptions(initialCopy));

  store.setSubscriptions([{
    sessionId: '157699', cinemaId: 'VIV', movieTitle: 'Spider Man', showTime: '20:30',
    areaCategory: '0000000009,0000000027,0000000005', targetCodes: [], targetDetails: {}, alerted: false, failCount: 0
  }]);

  // sessionCache miss: the handlers pass the display fallbacks
  store.upsertSubscription('VIV', '157699', '电影', '');
  assert.equal(store.getSubscriptions()[0].movieTitle, 'Spider Man', 'placeholder must not overwrite a stored title');
  assert.equal(store.getSubscriptions()[0].showTime, '20:30', 'empty showTime must not overwrite a stored one');

  // a real refresh still lands
  store.upsertSubscription('VIV', '157699', 'Real Title', '21:00');
  assert.equal(store.getSubscriptions()[0].movieTitle, 'Real Title');
  assert.equal(store.getSubscriptions()[0].showTime, '21:00');
});

test('loadSubscriptions refuses to start when the corrupt file cannot be quarantined', (t) => {
  t.mock.method(fs, 'existsSync', () => true);
  t.mock.method(fs, 'readFileSync', () => 'NOT JSON{{{');
  t.mock.method(fs, 'renameSync', () => { throw new Error('EACCES: permission denied'); });
  const errors = [];
  t.mock.method(console, 'error', (...a) => errors.push(a.join(' ')));

  assert.throws(() => store.loadSubscriptions(), /EACCES/, 'a failed backup must stop startup, not start empty');
});

test('upsertSubscription rejects every known display placeholder, not just 电影', (t) => {
  const initialCopy = store.getSubscriptions();
  t.after(() => store.setSubscriptions(initialCopy));

  store.setSubscriptions([{
    sessionId: '157699', cinemaId: 'VIV', movieTitle: 'Spider Man', showTime: '20:30',
    areaCategory: '0000000009,0000000027,0000000005', targetCodes: [], targetDetails: {}, alerted: false, failCount: 0
  }]);
  for (const ph of ['电影', '场次 157699', '未知电影']) {
    store.upsertSubscription('VIV', '157699', ph, '');
    assert.equal(store.getSubscriptions()[0].movieTitle, 'Spider Man', `placeholder ${ph} must not overwrite`);
  }
});
