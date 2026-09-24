'use strict';

// classifyInput 是从 handleSmartInput 抽出的纯函数：只分类、不做 I/O。
// 用例锁定六种 kind、分支优先级（顺序即语义），以及 seat-link 的右锚定下标偏移。
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
// 注：任务书原文期望 targetDate===undefined，但逐字抽取的实现做不到：
// '/select-seats/x/157699'.split('/') = ['', 'select-seats', 'x', '157699']，
// targetDate 取 parts[length-3] 得到 'select-seats'。按零行为变化契约锁定实际值。
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
test('case 6: trailing slash yields an empty sessionId', () => {
  assert.deepEqual(classifyInput('/select-seats/a/2026-01-01/VIV/'), {
    kind: 'seat-link',
    input: '/select-seats/a/2026-01-01/VIV/',
    isExplicitUuidCmd: false,
    sessionId: '',
    cinemaId: 'VIV',
    targetDate: '2026-01-01',
    itemKey: 'a',
    movieName: 'a'
  });
});

// 7
test('case 7: /movies/details/{itemkey} is a movie-link', () => {
  assert.deepEqual(classifyInput('/movies/details/spider-man'), {
    kind: 'movie-link',
    input: '/movies/details/spider-man',
    itemKey: 'spider-man',
    fallbackUuid: null
  });
});

// 8
test('case 8: movie link stops the itemkey at ?', () => {
  assert.deepEqual(classifyInput('/movies/spider-man?from=top#x'), {
    kind: 'movie-link',
    input: '/movies/spider-man?from=top#x',
    itemKey: 'spider-man',
    fallbackUuid: null
  });
});

test('case 8b: movie link pre-extracts a UUID reference as fallbackUuid', () => {
  assert.deepEqual(classifyInput('/movies/spider-man?ref=9b4d3f2a-1111-2222-3333-444455556666'), {
    kind: 'movie-link',
    input: '/movies/spider-man?ref=9b4d3f2a-1111-2222-3333-444455556666',
    itemKey: 'spider-man',
    fallbackUuid: '9b4d3f2a-1111-2222-3333-444455556666'
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
test('case 16: undecodable itemkey throws URIError synchronously', () => {
  assert.throws(
    () => classifyInput('/select-seats/%zz/2026-01-01/VIV/1'),
    (e) => e instanceof URIError
  );
});
