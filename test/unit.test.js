'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const axios = require('axios');
const monitor = require('../monitor.js');

const SRC_DIR = path.join(__dirname, '..', 'src');
const DATA_FILE = path.join(__dirname, '..', 'subscriptions.json');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// A fresh clone has no subscriptions.json (runtime state, gitignored);
// create an empty one first (loadSubscriptions semantics) so the sha256 check can run.
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

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
  const src = fs.readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8'))
    .join('\n');
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

test('callTgApi pins IPv4 and gives the long-poll timeout slack', async (t) => {
  const { callTgApi } = require('../src/telegram.js');
  const captured = [];
  t.mock.method(axios, 'post', async (url, data, cfg) => {
    captured.push(cfg);
    return { data: { ok: true, result: [] } };
  });

  await callTgApi('getMe', {});
  await callTgApi('getUpdates', { offset: -1, timeout: 30 }, 45000);

  assert.equal(captured.length, 2);
  assert.equal(captured[0].httpsAgent.options.family, 4, 'must pin IPv4 (host has no IPv6 route)');
  assert.equal(captured[0].timeout, 35000, 'default timeout stays 35s');
  assert.equal(captured[1].timeout, 45000, 'long-poll needs slack beyond the 30s server hold');
});

test('runProbeCycle keeps the alert pending when sendMessage fails, then delivers it once', async (t) => {
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (file, data) => writes.push({ file, data }));
  t.mock.method(console, 'error', () => {});

  let telegramUp = false;
  const sent = [];
  t.mock.method(axios, 'post', async (url, data) => {
    if (url.includes('api.telegram.org')) {
      if (!telegramUp) throw Object.assign(new Error('Request failed with status code 502'), { response: { data: { ok: false } } });
      sent.push(data);
      return { data: { ok: true, result: { message_id: 1 } } };
    }
    return {
      data: {
        results: {
          tickets: [{ ticketTypeCode: '5785', quantityAvailablePerOrder: 2, description: 'Promo', priceInCents: 600, longDescription: '' }]
        }
      }
    };
  });

  const sub = {
    sessionId: '90000002',
    cinemaId: 'VIV',
    movieTitle: 'M',
    showTime: '20:30',
    areaCategory: '0000000009',
    targetCodes: ['5785'],
    targetDetails: {},
    alerted: false,
    failCount: 0
  };
  monitor.setSubscriptions([sub]);
  t.after(() => monitor.setSubscriptions([]));

  await monitor.runProbeCycle();
  assert.equal(sub.alerted, false, 'a failed send must not mark the alert as delivered');
  assert.equal(writes.length, 0, 'nothing changed, nothing to persist');

  telegramUp = true;
  await monitor.runProbeCycle();
  await monitor.runProbeCycle();
  assert.equal(sent.length, 1, 'the alert is delivered exactly once after Telegram recovers');
  assert.equal(sub.alerted, true);
  assert.equal(writes.length, 1, 'alerted flag persisted once');
});

test('runProbeCycle survives the subscriptions array being replaced mid-cycle (/del)', async (t) => {
  t.mock.method(fs, 'writeFileSync', () => {});
  t.mock.method(console, 'error', () => {});
  let calls = 0;
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) return { data: { ok: true, result: {} } };
    calls++;
    if (calls === 1) monitor.setSubscriptions([]); // /del lands while the first fetch is in flight
    return { data: { results: { tickets: [] } } };
  });
  const mk = (id) => ({ sessionId: id, cinemaId: 'VIV', movieTitle: 'M', showTime: '', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: false, failCount: 0 });
  monitor.setSubscriptions([mk('90000003'), mk('90000004')]);
  t.after(() => monitor.setSubscriptions([]));

  await monitor.runProbeCycle(); // used to reject with a TypeError (unhandled under setInterval)
  assert.equal(calls, 1, 'the removed entry is not probed');
  assert.deepEqual(monitor.getSubscriptions(), []);
});
