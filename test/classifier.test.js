'use strict';

// classifyInput is the pure function extracted from handleSmartInput: classify only, no I/O.
// Cases lock the six kinds, branch priority (order is semantics), and the right-anchored offsets of seat-link parsing.
const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyInput } = require('../src/input-classifier.js');

// 1
test('case 1: bare /uuid cleans to empty', () => {
  assert.deepEqual(classifyInput('/uuid'), { kind: 'empty', input: '' });
});

// 2
test('case 2: @bot uuid cleans to empty', () => {
  assert.deepEqual(classifyInput('@mybot uuid'), { kind: 'empty', input: '' });
});

// 3
test('case 3: seat link splits from the right, itemkey becomes movieName', () => {
  assert.deepEqual(
    classifyInput('https://www.tgv.com.my/select-seats/spider-man/2026-09-24/VIV/157699'),
    {
      kind: 'seat-link',
      input: 'https://www.tgv.com.my/select-seats/spider-man/2026-09-24/VIV/157699',
      isExplicitUuidCmd: false,
      sessionId: '157699',
      cinemaId: 'VIV',
      targetDate: '2026-09-24',
      itemKey: 'spider-man',
      movieName: 'spider man'
    }
  );
});

// 4
test('case 4: /uuid-prefixed seat link keeps cleaned input and sets isExplicitUuidCmd', () => {
  assert.deepEqual(
    classifyInput('/uuid https://www.tgv.com.my/select-seats/spider-man/2026-09-24/VIV/157699'),
    {
      kind: 'seat-link',
      input: 'https://www.tgv.com.my/select-seats/spider-man/2026-09-24/VIV/157699',
      isExplicitUuidCmd: true,
      sessionId: '157699',
      cinemaId: 'VIV',
      targetDate: '2026-09-24',
      itemKey: 'spider-man',
      movieName: 'spider man'
    }
  );
});

// 5
// Note: the original task spec expected targetDate === undefined, but the verbatim extraction cannot produce that:
// '/select-seats/x/157699'.split('/') = ['', 'select-seats', 'x', '157699']，
// targetDate is parts[length-3], which yields 'select-seats' here. Locked to the actual value per the zero-behavior-change contract.
test('case 5: truncated seat link keeps right-anchored offsets; empty cinema falls back to default', () => {
  const r = classifyInput('/select-seats/x/157699');
  assert.deepEqual(r, {
    kind: 'seat-link',
    input: '/select-seats/x/157699',
    isExplicitUuidCmd: false,
    sessionId: '157699',
    cinemaId: 'x',
    targetDate: 'select-seats',
    itemKey: '',
    movieName: ''
  });
  assert.ok('targetDate' in r, 'targetDate key must always be present on a seat-link');

  const fallback = classifyInput('/select-seats/x/2026-01-01//157699', 'VIV');
  assert.equal(fallback.cinemaId, 'VIV', 'empty cinemaId must fall back to defaultCinemaId');
});

// 6
// Updated with the shared-link hardening: trailing slashes, ?query and #fragment
// are stripped before the right-anchored split, and a broken percent escape is
// kept raw instead of throwing (it used to reject with URIError).
test('case 6: trailing slash is stripped before the right-anchored split', () => {
  const c = classifyInput('/select-seats/a/2026-01-01/VIV/');
  // The link is truncated (no session id): after the strip the fields shift
  // one slot left, same as if the slash had never been typed.
  assert.equal(c.kind, 'seat-link');
  assert.equal(c.sessionId, 'VIV');
  assert.equal(c.cinemaId, '2026-01-01');
  assert.equal(c.targetDate, 'a');
});
test('case 6b: full trailing-slash link yields the real session id', () => {
  const withSlash = classifyInput('https://www.tgv.com.my/select-seats/a/2026-01-01/VIV/157699/');
  const clean = classifyInput('https://www.tgv.com.my/select-seats/a/2026-01-01/VIV/157699');
  const { input: _a, ...restA } = withSlash;
  const { input: _b, ...restB } = clean;
  assert.deepEqual(restA, restB);
});
test('case 6c: ?query and #fragment never leak into the session id', () => {
  const q = classifyInput('https://www.tgv.com.my/select-seats/a/2026-01-01/VIV/159681?utm_source=wa&x=1#frag');
  assert.equal(q.sessionId, '159681');
  assert.equal(q.cinemaId, 'VIV');
  assert.equal(q.targetDate, '2026-01-01');
  assert.equal(q.itemKey, 'a');
});

// 7
test('case 7: /movies/details/{itemkey} is a movie-link', () => {
  assert.deepEqual(classifyInput('/movies/details/spider-man'), {
    kind: 'movie-link',
    input: '/movies/details/spider-man',
    itemKey: 'spider-man'
  });
});

// 8
test('case 8: movie link stops the itemkey at ?', () => {
  assert.deepEqual(classifyInput('/movies/spider-man?from=top#x'), {
    kind: 'movie-link',
    input: '/movies/spider-man?from=top#x',
    itemKey: 'spider-man'
  });
});


// 9
test('case 9: bare /movies/ fails the inner regex and falls through to search', () => {
  assert.deepEqual(classifyInput('/movies/'), { kind: 'search', input: '/movies/' });
});

// 10
test('case 10: 5-8 digit session ids classify as session', () => {
  assert.deepEqual(classifyInput('12345'), { kind: 'session', input: '12345' });
  assert.deepEqual(classifyInput('12345678'), { kind: 'session', input: '12345678' });
});

// 11
test('case 11: session ids outside 5-8 digits fall through to search', () => {
  assert.deepEqual(classifyInput('1234'), { kind: 'search', input: '1234' });
  assert.deepEqual(classifyInput('123456789'), { kind: 'search', input: '123456789' });
});

// 12
test('case 12: uuid wins over alias (branch order lock)', () => {
  assert.deepEqual(classifyInput('9b4d3f2a-1111-2222-3333-444455556666'), {
    kind: 'uuid',
    input: '9b4d3f2a-1111-2222-3333-444455556666',
    uuid: '9b4d3f2a-1111-2222-3333-444455556666'
  });
});

// 13
test('case 13: uuid match is case-insensitive and preserves original case', () => {
  assert.deepEqual(classifyInput('9B4D3F2A-1111-2222-3333-444455556666'), {
    kind: 'uuid',
    input: '9B4D3F2A-1111-2222-3333-444455556666',
    uuid: '9B4D3F2A-1111-2222-3333-444455556666'
  });
});

// 14
test('case 14: uppercase fails the alias regex and falls to search', () => {
  assert.deepEqual(classifyInput('Spider-Man'), { kind: 'search', input: 'Spider-Man' });
});

// 15
test('case 15: alias needs lowercase and a hyphen', () => {
  assert.deepEqual(classifyInput('spider-man'), { kind: 'alias', input: 'spider-man' });
  assert.deepEqual(classifyInput('spiderman'), { kind: 'search', input: 'spiderman' });
});

// 16
// Updated: safeDecode keeps a broken percent escape raw instead of throwing;
// a hostile link must never break the polling loop that calls this.
test('case 16: undecodable itemkey is kept raw instead of throwing', () => {
  const r = classifyInput('/select-seats/%zz/2026-01-01/VIV/1');
  assert.equal(r.kind, 'seat-link');
  assert.equal(r.itemKey, '%zz');
});
