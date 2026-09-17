'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const axios = require('axios');
const monitor = require('../monitor.js');

const MONITOR_PATH = path.join(__dirname, '..', 'monitor.js');
const DATA_FILE = path.join(__dirname, '..', 'subscriptions.json');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('escapeHtml escapes & < > only, coerces non-strings, nullish -> empty', () => {
  const { escapeHtml } = monitor;
  assert.equal(escapeHtml('<b>&x</b>'), '&lt;b&gt;&amp;x&lt;/b&gt;');
  assert.equal(escapeHtml('a & b < c > d'), 'a &amp; b &lt; c &gt; d');
  assert.equal(escapeHtml(`O'Brien "quoted"`), `O'Brien "quoted"`);
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('parseCallback parses every new | payload form', () => {
  const { parseCallback } = monitor;
  const cases = [
    ['pick|VIV|12345678|20:30', { action: 'pick', args: ['VIV', '12345678', '20:30'] }],
    ['sub|VIV|12345678|5785', { action: 'sub', args: ['VIV', '12345678', '5785'] }],
    ['suball|VIV|12345678', { action: 'suball', args: ['VIV', '12345678'] }],
    ['del|12345678', { action: 'del', args: ['12345678'] }],
    ['quicksub|VIV|12345678', { action: 'quicksub', args: ['VIV', '12345678'] }],
    [
      'showall|VIV|12345678-1234-1234-1234-123456789abc|2026-09-17',
      { action: 'showall', args: ['VIV', '12345678-1234-1234-1234-123456789abc', '2026-09-17'] }
    ],
    ['refresh_dashboard', { action: 'refresh_dashboard', args: [] }]
  ];
  for (const [payload, expected] of cases) {
    assert.deepEqual(parseCallback(payload), expected, payload);
  }
});

test('parseCallback still routes legacy underscore payloads without misrouting', () => {
  const { parseCallback } = monitor;

  const pick = parseCallback('pick_VIV_157699_Spider_Man_20:30');
  assert.equal(pick.action, 'pick');
  assert.equal(pick.args[0], 'VIV');
  assert.equal(pick.args[1], '157699'); // session id survives the underscore in the title
  assert.equal(pick.args[2], '20:30');
  assert.equal(pick.args[3], 'Spider_Man');

  assert.deepEqual(parseCallback('sub_VIV_157699_5785'), { action: 'sub', args: ['VIV', '157699', '5785'] });
  assert.deepEqual(parseCallback('suball_VIV_157699'), { action: 'suball', args: ['VIV', '157699'] });
  assert.deepEqual(parseCallback('del_157699'), { action: 'del', args: ['157699'] });

  const quick = parseCallback('quicksub_VIV_157699_Spider_Man');
  assert.equal(quick.action, 'quicksub');
  assert.equal(quick.args[1], '157699');

  assert.deepEqual(
    parseCallback('showall_VIV_12345678-1234-1234-1234-123456789abc_2026-09-17'),
    { action: 'showall', args: ['VIV', '12345678-1234-1234-1234-123456789abc', '2026-09-17'] }
  );
});

test('parseCallback returns null for unparseable input', () => {
  const { parseCallback } = monitor;
  for (const bad of ['garbage', 'foo_bar_baz', '', null, undefined, 42, {}]) {
    assert.equal(parseCallback(bad), null, JSON.stringify(bad));
  }
});

test('every callback_data template stays within the 64-byte Telegram limit', () => {
  const src = fs.readFileSync(MONITOR_PATH, 'utf8');
  const templates = [...src.matchAll(/callback_data:\s*`([^`]+)`/g)].map((m) => m[1]);
  const plain = [...src.matchAll(/callback_data:\s*'([^']+)'/g)].map((m) => m[1]);

  const worstValue = (expr) => {
    if (expr.includes('movieId')) return '12345678-1234-1234-1234-123456789abc'; // 36 chars
    if (expr.includes('targetDate')) return '2026-09-17';
    if (expr.includes('time')) return '20:30';
    if (expr.includes('code')) return '5785';
    if (expr.includes('sessionId')) return '99999999';
    if (expr.includes('cinemaId')) return 'VIV';
    throw new Error(`unknown interpolation in callback_data template: ${expr}`);
  };

  const rendered = templates.map((tpl) => tpl.replace(/\$\{([^}]*)\}/g, (_, expr) => worstValue(expr)));

  // Every action the router knows must be represented by a real template in the source.
  for (const prefix of ['pick|', 'sub|', 'suball|', 'del|', 'quicksub|', 'showall|']) {
    assert.ok(rendered.some((p) => p.startsWith(prefix)), `missing callback_data template for ${prefix}`);
  }

  for (const payload of [...rendered, ...plain]) {
    const bytes = Buffer.byteLength(payload);
    assert.ok(bytes <= 64, `callback_data ${JSON.stringify(payload)} is ${bytes} bytes (> 64)`);
  }

  const worstCase = 'showall|VIV|12345678-1234-1234-1234-123456789abc|2026-09-17';
  assert.equal(Buffer.byteLength(worstCase), 59);
  assert.ok(Buffer.byteLength(worstCase) <= 64);
});

test('runProbeCycle is not reentrant and does not rewrite subscriptions.json', async (t) => {
  const before = sha256(DATA_FILE);

  const slowTickets = () =>
    new Promise((resolve) => {
      setTimeout(
        () =>
          resolve({
            data: {
              results: {
                tickets: [
                  {
                    ticketTypeCode: '5785',
                    quantityAvailablePerOrder: 0,
                    description: 'Promo A & B <limited>',
                    longDescription: 'nothing triggered'
                  }
                ]
              }
            }
          }),
        60
      );
    });

  const post = t.mock.method(axios, 'post', slowTickets);

  monitor.setSubscriptions([
    {
      sessionId: '90000001',
      cinemaId: 'VIV',
      movieTitle: 'Test & <Movie>',
      showTime: '20:30',
      areaCategory: '0000000009',
      targetCodes: ['5785'],
      targetDetails: { 5785: { name: 'Promo A & B', price: 1 } },
      alerted: false,
      failCount: 0
    }
  ]);

  const first = monitor.runProbeCycle();
  const second = monitor.runProbeCycle();
  await Promise.all([first, second]);

  assert.equal(post.mock.callCount(), 1, 'a second concurrent cycle must short-circuit');
  assert.equal(sha256(DATA_FILE), before, 'subscriptions.json must not be rewritten');

  monitor.setSubscriptions([]);
});
