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
  t.mock.method(fs, 'renameSync', () => {});
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

test('runProbeCycle removes a 15x-failed session only once the removal notice is delivered', async (t) => {
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (file, data) => writes.push(data));
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', () => {});
  let telegramUp = false;
  const sent = [];
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) {
      if (!telegramUp) throw new Error('Request failed with status code 502');
      sent.push(1);
      return { data: { ok: true, result: {} } };
    }
    throw new Error('tgv down'); // fetchTickets fails -> failCount climbs
  });
  const mk = () => ({ sessionId: '90000005', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: false, failCount: 0 });
  monitor.setSubscriptions([mk()]);
  t.after(() => monitor.setSubscriptions([]));

  for (let i = 0; i < 15; i++) await monitor.runProbeCycle();
  assert.equal(monitor.getSubscriptions().length, 1, 'an undelivered removal notice must keep the session for retry');
  assert.equal(monitor.getSubscriptions()[0].failCount, 15);
  assert.equal(writes.length, 0, 'nothing changed, nothing to persist');

  telegramUp = true;
  await monitor.runProbeCycle();
  assert.equal(monitor.getSubscriptions().length, 0, 'once the notice lands, the session is removed');
  assert.equal(sent.length, 1, 'exactly one removal notice across all cycles');
  assert.equal(writes.length, 1, 'the removal is persisted');
});

test('runProbeCycle removal splices the right entry when /del lands during the removal notice', async (t) => {
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (file, data) => writes.push(data));
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', () => {});
  let delLanded = false;
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) {
      // the removal notice is in flight; /del of A replaces the array now
      if (!delLanded) { delLanded = true; monitor.setSubscriptions(monitor.getSubscriptions().filter(s => s.sessionId !== 'A')); }
      return { data: { ok: true, result: {} } };
    }
    throw new Error('tgv down');
  });
  const mk = (id, fc) => ({ sessionId: id, cinemaId: 'VIV', movieTitle: id, showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: false, failCount: fc });
  monitor.setSubscriptions([mk('A', 0), mk('CAND', 15), mk('Z', 0)]);
  t.after(() => monitor.setSubscriptions([]));

  await monitor.runProbeCycle();
  const names = monitor.getSubscriptions().map(s => s.sessionId);
  assert.ok(!names.includes('CAND'), 'the dead candidate is removed');
  assert.ok(names.includes('Z'), 'the healthy Z must survive a stale-index splice');
});

test('adding an unavailable code does not re-announce the old code, and a newly opened code still alerts', async (t) => {
  t.mock.method(fs, 'writeFileSync', () => {});
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', () => {});
  // A (5785) available, B (5759) closed -> then B opens
  let bOpen = false;
  const sent = [];
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) { sent.push(1); return { data: { ok: true, result: {} } }; }
    return { data: { results: { tickets: [
      { ticketTypeCode: '5785', quantityAvailablePerOrder: 2, description: 'A', priceInCents: 600, longDescription: '' },
      bOpen ? { ticketTypeCode: '5759', quantityAvailablePerOrder: 3, description: 'B', priceInCents: 700, longDescription: '' } : { ticketTypeCode: '5759', quantityAvailablePerOrder: 0, description: 'B', priceInCents: 700, longDescription: "Today's Promotion Limit Reached" }
    ] } } };
  });
  const mk = () => ({ sessionId: '90000006', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: false, failCount: 0 });
  monitor.setSubscriptions([mk()]);
  t.after(() => monitor.setSubscriptions([]));

  await monitor.runProbeCycle();
  assert.equal(sent.length, 1, 'A alerts once');
  assert.equal(monitor.getSubscriptions()[0].alerted, true);

  // user adds unavailable code B; the delivered A must NOT be re-announced
  const sub = monitor.getSubscriptions()[0];
  sub.targetCodes.push('5759');

  await monitor.runProbeCycle();
  assert.equal(sent.length, 1, 'an added unavailable code must not re-announce the already-delivered A');
  assert.deepEqual(sub.alertedCodes, ['5785']);

  bOpen = true;
  await monitor.runProbeCycle();
  assert.equal(sent.length, 2, 'B opening must alert even while A is still available');
  assert.ok(sub.alertedCodes.includes('5759'), 'B is now marked delivered');
});

test('a legacy alerted sub (no alertedCodes) does not re-announce on the first probe after upgrade', async (t) => {
  t.mock.method(fs, 'writeFileSync', () => {});
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', () => {});
  const sent = [];
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) { sent.push(1); return { data: { ok: true, result: {} } }; }
    return { data: { results: { tickets: [
      { ticketTypeCode: '5785', quantityAvailablePerOrder: 2, description: 'A', priceInCents: 600, longDescription: '' }
    ] } } };
  });
  // legacy on-disk shape: alerted true, no alertedCodes field
  monitor.setSubscriptions([{ sessionId: '90000007', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: true, failCount: 0 }]);
  t.after(() => monitor.setSubscriptions([]));

  await monitor.runProbeCycle();
  assert.equal(sent.length, 0, 'a legacy already-delivered alert must not re-announce after upgrade');
  assert.deepEqual(monitor.getSubscriptions()[0].alertedCodes, ['5785'], 'delivery state migrates to per-code on the first probe');
});

test('legacy upgrade marks only currently-available codes delivered; an unavailable code still alerts later', async (t) => {
  t.mock.method(fs, 'writeFileSync', () => {});
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', () => {});
  let bOpen = false;
  const sent = [];
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) { sent.push(1); return { data: { ok: true, result: {} } }; }
    return { data: { results: { tickets: [
      { ticketTypeCode: '5785', quantityAvailablePerOrder: 2, description: 'A', priceInCents: 600, longDescription: '' },
      bOpen ? { ticketTypeCode: '5759', quantityAvailablePerOrder: 3, description: 'B', priceInCents: 700, longDescription: '' } : { ticketTypeCode: '5759', quantityAvailablePerOrder: 0, description: 'B', priceInCents: 700, longDescription: "Today's Promotion Limit Reached" }
    ] } } };
  });
  // legacy on-disk shape: A delivered (alerted true), B never opened yet
  monitor.setSubscriptions([{ sessionId: '90000008', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785', '5759'], targetDetails: {}, alerted: true, failCount: 0 }]);
  t.after(() => monitor.setSubscriptions([]));

  await monitor.runProbeCycle();
  assert.equal(sent.length, 0, 'A stays delivered, no re-announcement after upgrade');
  assert.deepEqual(monitor.getSubscriptions()[0].alertedCodes, ['5785'], 'only the currently-available code is migrated as delivered');

  bOpen = true;
  await monitor.runProbeCycle();
  assert.equal(sent.length, 1, 'B opening must still alert');
});

// --- 2026-11-06 fixes -----------------------------------------------------------

const { movieMetaCache, fetchMovieByItemKey, fetchTickets } = require('../src/tgv-api.js');

test('fetchTickets throws on a success:false body so the probe counts it as a failure', async (t) => {
  t.mock.method(axios, 'post', async () => ({
    data: { success: false, error: { code: 'EX-V', message: 'Error Getting Tickets' }, results: false }
  }));

  await assert.rejects(
    () => fetchTickets('VIV', '157699'),
    /TGV API EX-V: Error Getting Tickets/
  );
});

test('runProbeCycle auto-removes an expired session answering EX-V (was: empty list, failCount never grew)', async (t) => {
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (file, data) => writes.push(data));
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) return { data: { ok: true, result: {} } };
    return { data: { success: false, error: { code: 'EX-V', message: 'Error Getting Tickets' }, results: false } };
  });
  const mk = () => ({ sessionId: '90000010', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: false, failCount: 0 });
  monitor.setSubscriptions([mk()]);
  t.after(() => monitor.setSubscriptions([]));

  for (let i = 0; i < 15; i++) await monitor.runProbeCycle();

  assert.equal(monitor.getSubscriptions().length, 0, '15 EX-V strikes must remove the dead session');
  assert.equal(writes.length, 1, 'the removal is persisted once');
});

test('a sold-out delivered code re-arms and alerts again when it reopens (sibling still on sale)', async (t) => {
  t.mock.method(fs, 'writeFileSync', () => {});
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', () => {});
  let aOpen = true;
  const sent = [];
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) { sent.push(1); return { data: { ok: true, result: {} } }; }
    return { data: { results: { tickets: [
      aOpen ? { ticketTypeCode: '5785', quantityAvailablePerOrder: 2, description: 'A', priceInCents: 600, longDescription: '' } : { ticketTypeCode: '5785', quantityAvailablePerOrder: 0, description: 'A', priceInCents: 600, longDescription: "Today's Promotion Limit Reached" },
      { ticketTypeCode: '5759', quantityAvailablePerOrder: 3, description: 'B', priceInCents: 700, longDescription: '' }
    ] } } };
  });
  const mk = () => ({ sessionId: '90000011', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785', '5759'], targetDetails: {}, alerted: false, failCount: 0 });
  monitor.setSubscriptions([mk()]);
  t.after(() => monitor.setSubscriptions([]));

  await monitor.runProbeCycle();
  assert.equal(sent.length, 1, 'A+B alert once together');

  aOpen = false;
  await monitor.runProbeCycle();
  assert.equal(sent.length, 1, 'A sold out while B is still on sale: no new announcement yet');

  aOpen = true;
  await monitor.runProbeCycle();
  assert.equal(sent.length, 2, 'A reopening must alert again even though B stayed on sale');
  const sub = monitor.getSubscriptions()[0];
  assert.deepEqual(sub.alertedCodes.sort(), ['5759', '5785']);
});

test('runProbeCycle survives a failing save (was: unhandled rejection under setInterval)', async (t) => {
  const errs = [];
  t.mock.method(fs, 'writeFileSync', () => { throw new Error('EISDIR: illegal operation on a directory'); });
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', (m) => errs.push(m));
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) return { data: { ok: true, result: {} } };
    return { data: { results: { tickets: [{ ticketTypeCode: '5785', quantityAvailablePerOrder: 2, description: 'A', priceInCents: 600, longDescription: '' }] } } };
  });
  const sub = { sessionId: '90000012', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: false, failCount: 0 };
  monitor.setSubscriptions([sub]);
  t.after(() => monitor.setSubscriptions([]));

  await monitor.runProbeCycle(); // must resolve, not reject

  assert.equal(sub.alerted, true, 'the alert was sent and marked delivered');
  assert.ok(errs.some((m) => String(m).includes('保存订阅状态失败')), 'the save failure is logged loudly');
});

// --- movie lookup over the boxoffice catalogue -----------------------------------

function mockCatalogue(t, { ids, metas, nearest, metaOnDate }) {
  movieMetaCache.clear();
  t.mock.method(axios, 'post', async (url, payload) => {
    if (url.endsWith('moviesession_getcinemamovies')) return { data: { results: { movieidlist: ids } } };
    if (url.endsWith('moviesession_getnearestsessiondate')) return { data: { results: nearest(payload.movieid) } };
    if (url.endsWith('moviesession_get')) {
      const meta = (payload.businessdate && metaOnDate?.[payload.businessdate]?.[payload.movieid]) || metas[payload.movieid];
      return { data: meta === null ? { results: { movies: null } } : { results: { movies: [meta] } } };
    }
    return { data: {} };
  });
}

test('fetchMovieByItemKey matches an exact itemkey through the cinema catalogue', async (t) => {
  mockCatalogue(t, {
    ids: ['m1', 'm2'],
    metas: { m1: { recid: 'm1', name: 'Clayface', itemkey: 'clayface' }, m2: null }
  });
  assert.deepEqual(await fetchMovieByItemKey('Clayface'), { movieId: 'm1', name: 'Clayface' });
});

test('fetchMovieByItemKey matches a typed name with dashes read as spaces', async (t) => {
  mockCatalogue(t, {
    ids: ['m1'],
    metas: { m1: { recid: 'm1', name: 'Spider Man Brand New Day', itemkey: 'spider-man-brand-new-day' } }
  });
  assert.deepEqual(await fetchMovieByItemKey('spider man'), { movieId: 'm1', name: 'Spider Man Brand New Day' });
});

test('fetchMovieByItemKey falls back to the nearest session date for advance-selling movies', async (t) => {
  mockCatalogue(t, {
    ids: ['m1'],
    metas: { m1: null },
    nearest: () => ({ sessionfound: true, showtimemy: '2026-11-20T16:00:00' }),
    metaOnDate: { '2026-11-20': { m1: { recid: 'm1', name: 'Future Movie', itemkey: 'future-movie' } } }
  });
  assert.deepEqual(await fetchMovieByItemKey('future-movie'), { movieId: 'm1', name: 'Future Movie', nearestDate: '2026-11-20' });
});

test('fetchMovieByItemKey returns null when nothing matches', async (t) => {
  mockCatalogue(t, { ids: ['m1'], metas: { m1: { recid: 'm1', name: 'Clayface', itemkey: 'clayface' } } });
  assert.equal(await fetchMovieByItemKey('nope'), null);
});

test('movie metadata cache never leaks one cinema miss into another cinema', async (t) => {
  const seen = [];
  movieMetaCache.clear();
  t.mock.method(axios, 'post', async (url, payload) => {
    if (url.endsWith('moviesession_getcinemamovies')) return { data: { results: { movieidlist: ['m1'] } } };
    if (url.endsWith('moviesession_get')) {
      seen.push(payload);
      const hasSessions = payload.cinemaid === 'VIV2';
      return { data: hasSessions ? { results: { movies: [{ recid: 'm1', name: 'X', itemkey: 'x' }] } } : { results: { movies: null } } };
    }
    return { data: {} };
  });

  assert.equal(await fetchMovieByItemKey('x', 'VIV1'), null, 'no sessions at VIV1 -> miss (cached null)');
  assert.deepEqual(await fetchMovieByItemKey('x', 'VIV2'), { movieId: 'm1', name: 'X' }, "VIV2 must not see the cached null from VIV1");
  assert.ok(seen.every((p) => typeof p.businessdate === 'string'));
});

// --- Greptile round on PR #5 ----------------------------------------------------

test('an exact itemkey on an advance-selling movie beats a name match on a showing movie', async (t) => {
  movieMetaCache.clear();
  t.mock.method(axios, 'post', async (url, payload) => {
    if (url.endsWith('moviesession_getcinemamovies')) return { data: { results: { movieidlist: ['today', 'future'] } } };
    if (url.endsWith('moviesession_getnearestsessiondate')) return { data: { results: { sessionfound: true, showtimemy: '2026-11-20T16:00:00' } } };
    if (url.endsWith('moviesession_get')) {
      if (payload.movieid === 'today') {
        return { data: { results: { movies: [{ recid: 'today', name: 'Future Movie Saga', itemkey: 'future-movie-saga' }] } } };
      }
      return payload.businessdate === '2026-11-20'
        ? { data: { results: { movies: [{ recid: 'future', name: 'Future Movie', itemkey: 'future-movie' }] } } }
        : { data: { results: { movies: null } } };
    }
    return { data: {} };
  });

  // 'future-movie' as words ("future movie") substring-matches today's
  // "Future Movie Saga", but the future movie's exact itemkey must win.
  assert.deepEqual(await fetchMovieByItemKey('future-movie'), { movieId: 'future', name: 'Future Movie', nearestDate: '2026-11-20' });
});

test('fetchMovieByItemKey queries the cinema it was given, not always the default', async (t) => {
  movieMetaCache.clear();
  const seen = [];
  t.mock.method(axios, 'post', async (url, payload) => {
    if (url.endsWith('moviesession_getcinemamovies')) {
      seen.push(payload.cinemaid);
      return { data: { results: { movieidlist: payload.cinemaid === 'OTHER' ? ['m1'] : [] } } };
    }
    if (url.endsWith('moviesession_get')) return { data: { results: { movies: [{ recid: 'm1', name: 'X', itemkey: 'x' }] } } };
    return { data: {} };
  });

  assert.deepEqual(await fetchMovieByItemKey('x', 'OTHER'), { movieId: 'm1', name: 'X' });
  assert.deepEqual(seen, ['OTHER'], 'the lookup must hit the requested cinema catalogue');
});

test('the seat-link branch resolves the movie through the link cinema', async (t) => {
  movieMetaCache.clear();
  const catalogueCalls = [];
  t.mock.method(axios, 'post', async (url, payload) => {
    if (url.includes('api.telegram.org')) return { data: { ok: true, result: { message_id: 1 } } };
    if (url.endsWith('moviesession_getcinemamovies')) {
      catalogueCalls.push(payload.cinemaid);
      return { data: { results: { movieidlist: payload.cinemaid === 'OTHER' ? ['m1'] : [] } } };
    }
    if (url.endsWith('moviesession_get')) return { data: { results: { movies: [{ recid: 'm1', name: 'Only There', itemkey: 'only-there' }] } } };
    return { data: {} };
  });
  const handlers = require('../src/handlers.js');

  await handlers.handleSmartInput('https://www.tgv.com.my/select-seats/only-there/2026-11-06/OTHER/159681');

  assert.deepEqual(catalogueCalls, ['OTHER'], 'the seat-link lookup must use the cinema from the URL');
});

test('a plain search for an advance-selling movie lists that future date, not today', async (t) => {
  movieMetaCache.clear();
  const sessionCalls = [];
  t.mock.method(axios, 'post', async (url, payload) => {
    if (url.includes('api.telegram.org')) return { data: { ok: true, result: { message_id: 1 } } };
    if (url.endsWith('moviesession_getcinemamovies')) return { data: { results: { movieidlist: ['m1'] } } };
    if (url.endsWith('moviesession_get')) {
      sessionCalls.push(payload.businessdate);
      return payload.businessdate === '2026-11-20'
        ? { data: { results: { movies: [{ recid: 'm1', name: 'Future Movie', itemkey: 'future-movie' }], businessday: { cinemas: [{ movies: [{ experiences: [{ sessions: [{ sessionid: 999, screenname: 'H1', showtimemy: '2026-11-20T20:30:00' }] }] }] }] } } } }
        : { data: { results: { movies: null } } };
    }
    if (url.endsWith('moviesession_getnearestsessiondate')) return { data: { results: { sessionfound: true, showtimemy: '2026-11-20T16:00:00' } } };
    return { data: {} };
  });
  const handlers = require('../src/handlers.js');

  await handlers.handleSmartInput('future movie');

  assert.ok(sessionCalls.includes('2026-11-20'), 'the session listing must query the nearest date: ' + sessionCalls.join(','));
});

test('a failed save is retried on a later cycle with no new state change', async (t) => {
  const writes = [];
  let failFirst = true;
  t.mock.method(fs, 'writeFileSync', (file, data) => {
    if (failFirst) throw new Error('EISDIR');
    writes.push(data);
  });
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', () => {});
  let aOpen = false;
  t.mock.method(axios, 'post', async (url) => {
    if (url.includes('api.telegram.org')) return { data: { ok: true, result: {} } };
    return { data: { results: { tickets: [
      aOpen ? { ticketTypeCode: '5785', quantityAvailablePerOrder: 2, description: 'A', priceInCents: 600, longDescription: '' } : { ticketTypeCode: '5785', quantityAvailablePerOrder: 0, description: 'A', priceInCents: 600, longDescription: "Today's Promotion Limit Reached" }
    ] } } };
  });
  const sub = { sessionId: '90000013', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: false, alertedCodes: [], failCount: 0 };
  monitor.setSubscriptions([sub]);
  t.after(() => monitor.setSubscriptions([]));

  aOpen = true;
  await monitor.runProbeCycle(); // alert delivered, save fails
  assert.equal(writes.length, 0);

  // State stays identical this cycle (aOpen still true, already delivered):
  // only the pending flag may force the save.
  failFirst = false;
  await monitor.runProbeCycle();
  assert.equal(writes.length, 1, 'the pending save retries on the next cycle');
  await monitor.runProbeCycle(); // flag cleared: no further writes
  assert.equal(writes.length, 1);
});

test('the sold-out marker string lives in exactly one place', () => {
  const hits = fs.readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => fs.readFileSync(path.join(SRC_DIR, f), 'utf8').includes("Today's Promotion Limit Reached"));
  assert.deepEqual(hits, ['tgv-api.js']);
});
