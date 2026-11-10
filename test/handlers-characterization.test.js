'use strict';

// Characterization net for the three exported functions of src/handlers.js.
// Locks the CURRENT byte-exact behaviour against the unmodified src/ (baseline
// commit fdd2ed6). These tests intentionally codify quirks (e.g. the unsaved
// in-memory refresh in the duplicate-`sub` path). If a future refactor changes
// any string or side-effect below, that change must be deliberate.
//
// Every test mocks fs.writeFileSync first: src/store.js saveSubscriptions would
// otherwise rewrite the real subscriptions.json, which test/unit.test.js hashes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const axios = require('axios');

const { handleSmartInput, handleMessage, handleCallbackQuery } = require('../src/handlers.js');
const store = require('../src/store.js');
const { TG_CHAT_ID } = require('../src/config.js');
const { movieMetaCache } = require('../src/tgv-api.js');

// The 19-char horizontal rule used by both /list and the /del callback copy.
const SEP = '─'.repeat(19);

// --- harness -----------------------------------------------------------------

// Snapshot + restore the live subscriptions array and the session cache so no
// test leaks state into the next one.
function isolate(t) {
  movieMetaCache.clear();
  const subs = store.getSubscriptions().slice();
  const cache = new Map(store.sessionCache);
  t.after(() => {
    store.setSubscriptions(subs);
    store.sessionCache.clear();
    for (const [k, v] of cache) store.sessionCache.set(k, v);
  });
}

// Mandatory: never let saveSubscriptions touch the real JSON file.
function mockWrites(t) {
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (file, data) => {
    writes.push({ file, data });
  });
  // saveSubscriptions renames the tmp file over the live one; keep it off the real fs
  t.mock.method(fs, 'renameSync', () => {});
  return writes;
}

// Route axios.post by URL. Telegram calls are captured in `sent`; TGV calls are
// answered from `fixtures` keyed by the last path segment (e.g. movie_getbyitemkey).
function mockAxios(t, fixtures = {}) {
  const sent = [];
  const tgvEndpoints = [];
  t.mock.method(axios, 'post', async (url, data) => {
    if (url.includes('api.telegram.org')) {
      sent.push({ method: url.split('/').pop(), payload: data });
      return { data: { ok: true, result: { message_id: 1 } } };
    }
    if (url.includes('api.tgv.com.my')) {
      const endpoint = url.split('/').pop();
      tgvEndpoints.push(endpoint);
      if (Object.prototype.hasOwnProperty.call(fixtures, endpoint)) return fixtures[endpoint];
      return { data: { results: {} } };
    }
    return { data: {} };
  });
  return { sent, tgvEndpoints };
}

function lastSend(sent) {
  return sent[sent.length - 1];
}

// --- 1 -----------------------------------------------------------------------

test('/start sends the exact help text once with HTML parse_mode', async (t) => {
  isolate(t);
  const { sent } = mockAxios(t);
  mockWrites(t);

  await handleMessage({ text: '/start', chat: { id: TG_CHAT_ID } });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(sent[0].payload.parse_mode, 'HTML');
  assert.equal(
    sent[0].payload.text,
    '🎬 <b>TGV 极速抢票监控系统</b>\n\n' +
      '快捷指令：\n' +
      '🔹 <code>/uuid &lt;链接或UUID&gt;</code> - 查 UUID 并列出全天排片\n' +
      '🔹 <code>/check</code> - 实时票况看板（支持原地刷新）\n' +
      '🔹 <code>/list</code> - 查看监控列表\n' +
      '🔹 <code>/del</code> - 选择删除已监控场次\n' +
      '🔹 <code>/status</code> - 运行健康状况\n\n' +
      '直接发送任意选座直链、电影链接或电影名均可智能处理。'
  );
});

// --- 2 -----------------------------------------------------------------------

test('/list with zero subscriptions sends the exact empty-list notice', async (t) => {
  isolate(t);
  const { sent } = mockAxios(t);
  mockWrites(t);
  store.setSubscriptions([]);

  await handleMessage({ text: '/list', chat: { id: TG_CHAT_ID } });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(sent[0].payload.text, 'ℹ️ 当前无监控任务。直接发送电影链接或编号即可添加。');
});

// --- 3 -----------------------------------------------------------------------

test('/list with one seeded sub renders the exact block and the raw 5785 fallback', async (t) => {
  isolate(t);
  const { sent } = mockAxios(t);
  mockWrites(t);
  store.setSubscriptions([
    {
      sessionId: '157699',
      cinemaId: 'VIV',
      movieTitle: 'Spider & Man',
      showTime: '20:30',
      targetCodes: ['5785'],
      targetDetails: {}
    }
  ]);

  await handleMessage({ text: '/list', chat: { id: TG_CHAT_ID } });

  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].payload.text,
    '📋 <b>当前监控任务列表 (1)：</b>\n\n' +
      '🎬 <b>《Spider &amp; Man》</b>\n' +
      '⏰ 时间: <code>20:30</code> | 影院: VIV (ID: <code>157699</code>)\n' +
      '🎯 监控票种:\n  • 5785\n' +
      '🔔 状态: 💤 静默轮询中\n' +
      `${SEP}\n`
  );
  assert.ok(sent[0].payload.text.includes('5785'), 'raw code fallback must survive');
});

// --- 4 -----------------------------------------------------------------------

test('/status reports the live subscription count', async (t) => {
  isolate(t);
  const { sent } = mockAxios(t);
  mockWrites(t);
  store.setSubscriptions([
    {
      sessionId: '157699',
      cinemaId: 'VIV',
      movieTitle: 'X',
      showTime: '20:30',
      targetCodes: ['5785'],
      targetDetails: {}
    }
  ]);

  await handleMessage({ text: '/status', chat: { id: TG_CHAT_ID } });

  assert.equal(sent.length, 1);
  assert.ok(sent[0].payload.text.includes('监控中场次: <b>1</b> 个'));
});

// --- 5 -----------------------------------------------------------------------

test('handleMessage ignores a chat id that is not TG_CHAT_ID (no telegram, no tgv)', async (t) => {
  isolate(t);
  const { sent, tgvEndpoints } = mockAxios(t);
  mockWrites(t);
  const otherChatId = String(TG_CHAT_ID) === '999' ? '998' : '999';

  await handleMessage({ text: '/start', chat: { id: otherChatId } });

  assert.equal(sent.length, 0);
  assert.equal(tgvEndpoints.length, 0);
});

// --- 6 -----------------------------------------------------------------------

test('select-seats link (no /uuid) emits the exact card, two buttons and caches the session', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t, {
    moviesession_getcinemamovies: { data: { results: { movieidlist: ['uuid-1'] } } },
    moviesession_get: { data: { results: { movies: [{ recid: 'uuid-1', name: 'Spider Man', itemkey: 'spider-man' }] } } }
  });

  await handleSmartInput('https://www.tgv.com.my/select-seats/spider-man/2026-09-24/VIV/157699');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(
    sent[0].payload.text,
    '🎯 <b>已识别电影:</b> 《Spider Man》\n' +
      '🆔 <b>Movie UUID:</b> <code>uuid-1</code>\n' +
      '📍 <b>影院:</b> VIV | <b>排片日期:</b> <code>2026-09-24</code>\n' +
      '🎫 <b>目标场次:</b> <code>157699</code>\n\n' +
      '👇 <b>请选择操作：</b>'
  );

  const buttons = sent[0].payload.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].callback_data, 'showall|VIV|uuid-1|2026-09-24');
  assert.equal(buttons[1].callback_data, 'quicksub|VIV|157699');

  // Updated: the cache now prefers the resolved movie name over the URL slug
  assert.deepEqual(store.sessionCache.get('VIV_157699'), { movieName: 'Spider Man', showTime: '' });
});

// --- 7 -----------------------------------------------------------------------

test('/uuid select-seats link sends the parse notice then lists sessions with a pick button', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t, {
    moviesession_getcinemamovies: { data: { results: { movieidlist: ['uuid-1'] } } },
    moviesession_get: {
      data: {
        results: {
          movies: [{ recid: 'uuid-1', name: 'X', itemkey: 'spider-man' }],
          businessday: {
            cinemas: [
              {
                movies: [
                  {
                    experiences: [
                      {
                        sessions: [
                          { sessionid: 157699, screenname: 'H2', showtimemy: '2026-09-24T20:30:00' }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        }
      }
    }
  });

  await handleSmartInput('/uuid https://www.tgv.com.my/select-seats/spider-man/2026-09-24/VIV/157699');

  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(
    sent[0].payload.text,
    '🎯 正在从选座链接解析电影别名 <code>spider-man</code> 与排片日期 <code>2026-09-24</code>...'
  );

  const buttons = sent
    .flatMap((c) => (c.payload && c.payload.reply_markup ? c.payload.reply_markup.inline_keyboard : []))
    .flat();
  assert.ok(buttons.some((b) => b.callback_data === 'pick|VIV|157699|20:30'));
});

// --- 8 -----------------------------------------------------------------------

// Updated: the classifier no longer throws on a broken percent escape; the
// lookup simply misses and the card offers the quicksub button only.
test('malformed percent-encoding degrades to the lookup-miss card', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent, tgvEndpoints } = mockAxios(t, {
    moviesession_getcinemamovies: { data: { results: { movieidlist: [] } } }
  });

  await handleSmartInput('https://x/select-seats/%zz/2026-01-01/VIV/1');

  assert.equal(sent.length, 1);
  const buttons = sent[0].payload.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map((b) => b.callback_data), ['quicksub|VIV|1']);
  assert.ok(tgvEndpoints.includes('moviesession_getcinemamovies'));
});

// --- 9 -----------------------------------------------------------------------

test('sub callback creates the exact subscription record, persists once and replies', async (t) => {
  isolate(t);
  const writes = mockWrites(t);
  const { sent } = mockAxios(t, {
    moviesession_gettickets: {
      data: {
        results: {
          tickets: [
            { ticketTypeCode: 5785, description: 'Promo A', priceInCents: 600, quantityAvailablePerOrder: 0 }
          ]
        }
      }
    }
  });
  store.setSubscriptions([]);

  await handleCallbackQuery({ id: '1', data: 'sub|VIV|157699|5785', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

  assert.equal(writes.length, 1);
  const parsed = JSON.parse(writes[0].data);
  assert.deepEqual(parsed, [
    {
      sessionId: '157699',
      cinemaId: 'VIV',
      movieTitle: '电影',
      showTime: '',
      areaCategory: '0000000009,0000000027,0000000005',
      targetCodes: ['5785'],
      targetDetails: { 5785: { name: 'Promo A', price: 6 } },
      alerted: false,
      alertedCodes: [],
      failCount: 0
    }
  ]);
  assert.equal(
    Object.keys(parsed[0]).join(','),
    'sessionId,cinemaId,movieTitle,showTime,areaCategory,targetCodes,targetDetails,alerted,alertedCodes,failCount'
  );

  const answer = sent.find((c) => c.method === 'answerCallbackQuery');
  assert.equal(answer.payload.text, '已添加 Promo A');

  assert.equal(lastSend(sent).method, 'sendMessage');
  assert.equal(
    lastSend(sent).payload.text,
    '✅ <b>订阅成功！</b>\n电影: <b>《电影》</b>\n票种: <b>Promo A</b> (RM6)'
  );
});

// --- 10 ----------------------------------------------------------------------

test('sub callback duplicate target: no save, alert, but in-memory refresh is left unpersisted', async (t) => {
  isolate(t);
  const writes = mockWrites(t);
  const { sent } = mockAxios(t, {
    moviesession_gettickets: {
      data: {
        results: {
          tickets: [
            { ticketTypeCode: 5785, description: 'Promo A', priceInCents: 600, quantityAvailablePerOrder: 0 }
          ]
        }
      }
    }
  });
  store.setSubscriptions([
    {
      sessionId: '157699',
      cinemaId: 'VIV',
      movieTitle: 'STALE',
      showTime: '09:00',
      areaCategory: '0000000009',
      targetCodes: ['5785'],
      targetDetails: { 5785: { name: 'Old', price: 1 } },
      alerted: false,
      failCount: 0
    }
  ]);

  await handleCallbackQuery({ id: '1', data: 'sub|VIV|157699|5785', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

  // Early return precedes saveSubscriptions: the refresh below is NOT persisted.
  assert.equal(writes.length, 0);
  const answer = sent.find((c) => c.method === 'answerCallbackQuery');
  assert.equal(answer.payload.text, '已在监控中');
  assert.equal(answer.payload.show_alert, true);
  // Locked quirk, updated with the F2 metadata guard: the placeholder refresh
  // ('电影' from a sessionCache miss) no longer overwrites the stored title.
  assert.equal(store.getSubscriptions()[0].movieTitle, 'STALE');
});

// --- 11 ----------------------------------------------------------------------

test('suball picks descriptionAlt PROMO plus hardcoded 6336 and persists exactly those codes', async (t) => {
  isolate(t);
  const writes = mockWrites(t);
  const { sent } = mockAxios(t, {
    moviesession_gettickets: {
      data: {
        results: {
          tickets: [
            { ticketTypeCode: 5785, description: 'A', descriptionAlt: 'PROMO X', priceInCents: 600 },
            { ticketTypeCode: 6336, description: 'B', priceInCents: 700 },
            { ticketTypeCode: 1234, description: 'C', priceInCents: 800 }
          ]
        }
      }
    }
  });
  store.setSubscriptions([]);

  await handleCallbackQuery({ id: '1', data: 'suball|VIV|157699', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

  assert.equal(writes.length, 1);
  const parsed = JSON.parse(writes[0].data);
  assert.deepEqual(parsed[0].targetCodes, ['5785', '6336']);

  assert.equal(lastSend(sent).method, 'sendMessage');
  assert.equal(
    lastSend(sent).payload.text,
    '✅ <b>《电影》已添加促销票监控！</b>\n时间: <code></code>\n包含票种:\n• A\n• B'
  );
});

// --- 12 ----------------------------------------------------------------------

test('del callback removes the seeded sub, saves once and replies with two exact messages', async (t) => {
  isolate(t);
  const writes = mockWrites(t);
  const { sent } = mockAxios(t);
  store.setSubscriptions([
    {
      sessionId: '157699',
      cinemaId: 'VIV',
      movieTitle: 'Spider Man',
      showTime: '20:30',
      areaCategory: '0000000009',
      targetCodes: ['5785'],
      targetDetails: {},
      alerted: false,
      failCount: 0
    }
  ]);

  await handleCallbackQuery({ id: '1', data: 'del|157699', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

  assert.equal(store.getSubscriptions().find((s) => s.sessionId === '157699'), undefined);
  assert.equal(writes.length, 1);

  const answer = sent.find((c) => c.method === 'answerCallbackQuery');
  assert.equal(answer.payload.text, '已移除《Spider Man》');

  assert.equal(lastSend(sent).method, 'sendMessage');
  assert.equal(
    lastSend(sent).payload.text,
    '🗑️ <b>已成功移除:</b> 《Spider Man》 (场次 <code>157699</code>)'
  );
});

// --- 13 ----------------------------------------------------------------------

test('pick/quicksub fall back from cache to payload to defaults', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t);

  // (a) cache wins for showTime
  store.sessionCache.set('VIV_157699', { movieName: 'Cached', showTime: '19:00' });
  await handleCallbackQuery({ id: '1', data: 'pick|VIV|157699|20:30|Spider', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });
  assert.equal(sent.find((c) => c.method === 'answerCallbackQuery').payload.text, '已选 19:00');

  // (b) empty cache -> payload showTime
  sent.length = 0;
  store.sessionCache.delete('VIV_157699');
  await handleCallbackQuery({ id: '1', data: 'pick|VIV|157699|20:30|Spider', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });
  assert.equal(sent.find((c) => c.method === 'answerCallbackQuery').payload.text, '已选 20:30');

  // (c) quicksub legacy name argument
  sent.length = 0;
  await handleCallbackQuery({ id: '1', data: 'quicksub|VIV|157699|Legacy', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });
  assert.ok(sent.some((c) => c.method === 'sendMessage' && c.payload.text.includes('Legacy')));

  // (d) quicksub with no legacy arg -> falls back to the default movie name
  sent.length = 0;
  await handleCallbackQuery({ id: '1', data: 'quicksub|VIV|157699', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });
  assert.ok(sent.some((c) => c.method === 'sendMessage' && c.payload.text.includes('电影')));
});

// --- 14 ----------------------------------------------------------------------

test('unknown action and unparseable payload both fall back to the retry hint', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t);

  // parseCallback succeeds but no branch matches -> final return
  await handleCallbackQuery({ id: '1', data: 'foo|bar', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });
  assert.equal(lastSend(sent).payload.text, '请重新发送电影名或链接后再试');

  // parseCallback returns null -> early return
  sent.length = 0;
  await handleCallbackQuery({ id: '1', data: 'garbage', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });
  assert.equal(lastSend(sent).payload.text, '请重新发送电影名或链接后再试');
});

// --- 15 ----------------------------------------------------------------------

test('movie-link whose lookup fails falls through to the plain-search tail', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t);

  await handleSmartInput('/movies/spider-man');

  assert.equal(sent.length, 3);
  assert.equal(sent[0].payload.text, '🔎 正在解析电影别名: <code>spider-man</code>');
  assert.equal(sent[1].payload.text, '🔎 正在搜索电影：<b>/movies/spider-man</b>');
  assert.equal(
    sent[2].payload.text,
    '❌ 未能匹配到电影《/movies/spider-man》，若该片尚未定档或放排片，TGV 系统内暂无记录。'
  );
});

// --- 16 ----------------------------------------------------------------------

test('alias whose lookup fails falls through to the plain-search tail', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t);

  await handleSmartInput('spider-man');

  assert.equal(sent.length, 3);
  assert.equal(sent[0].payload.text, '🔎 正在根据别名检索: <code>spider-man</code>');
  assert.equal(sent[1].payload.text, '🔎 正在搜索电影：<b>spider-man</b>');
  assert.equal(
    sent[2].payload.text,
    '❌ 未能匹配到电影《spider-man》，若该片尚未定档或放排片，TGV 系统内暂无记录。'
  );
});

// --- 17 ----------------------------------------------------------------------

test('movie-link holding a UUID still falls through to the plain-search tail', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t);

  await handleSmartInput('/movies/details/9b4d3f2a-1111-2222-3333-444455556666');

  assert.equal(sent.length, 3);
  assert.equal(sent[0].payload.text, '🔎 正在解析电影别名: <code>9b4d3f2a-1111-2222-3333-444455556666</code>');
  assert.equal(sent[1].payload.text, '🔎 正在搜索电影：<b>/movies/details/9b4d3f2a-1111-2222-3333-444455556666</b>');
  assert.equal(
    sent[2].payload.text,
    '❌ 未能匹配到电影《/movies/details/9b4d3f2a-1111-2222-3333-444455556666》，若该片尚未定档或放排片，TGV 系统内暂无记录。'
  );
});

// --- fetch failure -------------------------------------------------------------

for (const data of ['sub|VIV|157699|5785', 'suball|VIV|157699']) {
  test(`${data.split('|')[0]} callback answers with an alert when the ticket fetch throws`, async (t) => {
    isolate(t);
    const writes = mockWrites(t);
    const sent = [];
    t.mock.method(axios, 'post', async (url, payload) => {
      if (url.includes('api.telegram.org')) {
        sent.push({ method: url.split('/').pop(), payload });
        return { data: { ok: true, result: { message_id: 1 } } };
      }
      throw new Error('timeout of 8000ms exceeded');
    });
    store.setSubscriptions([]);

    await handleCallbackQuery({ id: '1', data, message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

    assert.equal(writes.length, 0);
    assert.equal(store.getSubscriptions().length, 0);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'answerCallbackQuery');
    assert.equal(sent[0].payload.text, '查询票种失败，请稍后重试');
    assert.equal(sent[0].payload.show_alert, true);
  });
}

// --- alert reset / composite delete ---------------------------------------------

test('adding a ticket code to an already-alerted sub lets the new code alert (per-code state)', async (t) => {
  isolate(t);
  const writes = mockWrites(t);
  mockAxios(t, {
    moviesession_gettickets: {
      data: { results: { tickets: [{ ticketTypeCode: 5759, description: 'Promo B', priceInCents: 700, quantityAvailablePerOrder: 0 }] } }
    }
  });
  store.setSubscriptions([{ sessionId: '157699', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: true, alertedCodes: ['5785'], failCount: 0 }]);

  await handleCallbackQuery({ id: '1', data: 'sub|VIV|157699|5759', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

  assert.equal(writes.length, 1);
  const saved = JSON.parse(writes[0].data)[0];
  assert.deepEqual(saved.targetCodes, ['5785', '5759']);
  assert.ok(!saved.alertedCodes.includes('5759'), 'the new code is undelivered and can alert');
  assert.deepEqual(saved.alertedCodes, ['5785'], 'the delivered code keeps its delivered state (no re-announce)');
});

test('/del buttons carry the cinema and the callback deletes only that (cinema, session) pair', async (t) => {
  isolate(t);
  const writes = mockWrites(t);
  const { sent } = mockAxios(t);
  store.setSubscriptions([{ sessionId: '157699', cinemaId: 'VIV', movieTitle: 'A', showTime: '20:30', areaCategory: '0000000009', targetCodes: ["5785"], targetDetails: {}, alerted: false, failCount: 0 }, { sessionId: '157699', cinemaId: 'OTHER', movieTitle: 'B', showTime: '20:30', areaCategory: '0000000009', targetCodes: ["5785"], targetDetails: {}, alerted: false, failCount: 0 }]);

  await handleMessage({ text: '/del', chat: { id: TG_CHAT_ID } });
  const buttons = lastSend(sent).payload.reply_markup.inline_keyboard.map((row) => row[0].callback_data);
  assert.deepEqual(buttons, ['del|VIV|157699', 'del|OTHER|157699']);

  await handleCallbackQuery({ id: '1', data: 'del|OTHER|157699', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

  assert.deepEqual(store.getSubscriptions().map((s) => s.cinemaId), ['VIV']);
  assert.equal(writes.length, 1);
  const answer = sent.find((c) => c.method === 'answerCallbackQuery');
  assert.equal(answer.payload.text, '已移除《B》');
});

// --- callback gate (2026-11-06 fix) --------------------------------------------

test('a callback from a chat that is not TG_CHAT_ID is refused without side effects', async (t) => {
  isolate(t);
  const writes = mockWrites(t);
  const { sent } = mockAxios(t);
  const otherChatId = String(TG_CHAT_ID) === '999' ? '998' : '999';
  store.setSubscriptions([{ sessionId: '555', cinemaId: 'VIV', movieTitle: 'A', showTime: '', areaCategory: '0000000009', targetCodes: ['5785'], targetDetails: {}, alerted: false, failCount: 0 }]);

  await handleCallbackQuery({ id: '1', data: 'del|VIV|555', from: { id: 7 }, message: { message_id: 2, chat: { id: otherChatId } } });

  assert.equal(store.getSubscriptions().length, 1, 'a foreign chat must not delete subscriptions');
  assert.equal(writes.length, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'answerCallbackQuery');
  assert.equal(sent[0].payload.text, '无权操作');
});

// --- message chunking (2026-11-06 fix) -------------------------------------------

test('/list splits into chunks under the Telegram limit instead of sending nothing', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t);
  const subs = [];
  for (let i = 0; i < 30; i++) {
    subs.push({
      sessionId: String(150000 + i), cinemaId: 'VIV', movieTitle: 'Ramayana: Rise Of A Legend (Tamil)', showTime: '20:30',
      areaCategory: '0000000009', targetCodes: ['5785', '5759', '6336'],
      targetDetails: { 5785: { name: 'Promo Ticket Alpha' }, 5759: { name: 'Promo Ticket Beta' }, 6336: { name: 'Promo Ticket Gamma' } },
      alerted: false, failCount: 0
    });
  }
  store.setSubscriptions(subs);

  await handleMessage({ text: '/list', chat: { id: TG_CHAT_ID } });

  assert.ok(sent.length > 1, '30 subs must produce more than one message');
  for (const m of sent) {
    assert.ok(m.payload.text.length <= 4096, 'every chunk must fit the Telegram limit');
  }
  assert.ok(sent.some((m) => m.payload.text.includes('150029')), 'the last sub must be present in some chunk');
});

test('dashboard splits into chunks and keeps the refresh button on the last one', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t, {
    moviesession_gettickets: { data: { results: { tickets: [
      { ticketTypeCode: 5785, description: 'Promo Alpha', priceInCents: 600, quantityAvailablePerOrder: 0 },
      { ticketTypeCode: 5759, description: 'Promo Beta', priceInCents: 700, quantityAvailablePerOrder: 0 },
      { ticketTypeCode: 6336, description: 'Promo Gamma', priceInCents: 800, quantityAvailablePerOrder: 0 }
    ] } } }
  });
  const subs = [];
  for (let i = 0; i < 30; i++) {
    subs.push({ sessionId: String(150000 + i), cinemaId: 'VIV', movieTitle: 'Ramayana: Rise Of A Legend (Tamil)', showTime: '20:30', areaCategory: '0000000009', targetCodes: ['5785', '5759', '6336'], targetDetails: {}, alerted: false, failCount: 0 });
  }
  store.setSubscriptions(subs);

  await handleMessage({ text: '/check', chat: { id: TG_CHAT_ID } });

  const sends = sent.filter((m) => m.method === 'sendMessage');
  assert.ok(sends.length > 1, '30 subs must produce more than one dashboard message');
  for (const m of sends) assert.ok(m.payload.text.length <= 4096);
  assert.ok(sends[sends.length - 1].payload.reply_markup, 'refresh button rides the last chunk');
  for (const m of sends.slice(0, -1)) assert.equal(m.payload.reply_markup, undefined);
});

// --- sold-out promo truthfulness (live finding 2026-11-06, session 160600) ------
// quantityAvailablePerOrder stays 20 after the daily promo limit is reached; the
// picker used to advertise that number as if it were stock.

test('the ticket picker marks a limit-reached promo as sold out instead of showing quota', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t, {
    moviesession_gettickets: { data: { results: { tickets: [
      { ticketTypeCode: 5785, description: 'Maybank Mastercard Single', priceInCents: 1000, quantityAvailablePerOrder: 20, descriptionAlt: 'PROMO:MBBMASTERRM10', longDescription: "RM10 ticket with Maybank Mastercard debit card\nToday's Promotion Limit Reached" },
      { ticketTypeCode: 3988, description: 'SINGLE', priceInCents: 2000, quantityAvailablePerOrder: 20, longDescription: '' }
    ] } } }
  });

  await handleSmartInput('157699');

  const buttons = sent.flatMap((c) => c.payload.reply_markup?.inline_keyboard || []).flat();
  assert.equal(
    buttons.find((b) => b.callback_data === 'sub|VIV|157699|5785').text,
    '🔥 Maybank Mastercard Single (RM10) [今日额度已尽]'
  );
  assert.equal(
    buttons.find((b) => b.callback_data === 'sub|VIV|157699|3988').text,
    '🎟️ SINGLE (RM20) [剩余:20]'
  );
});

test('sub confirmation carries the sold-out warning for a limit-reached ticket', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t, {
    moviesession_gettickets: { data: { results: { tickets: [
      { ticketTypeCode: 5785, description: 'Maybank Mastercard Single', priceInCents: 1000, quantityAvailablePerOrder: 20, longDescription: "RM10 ticket with Maybank Mastercard debit card\nToday's Promotion Limit Reached" }
    ] } } }
  });
  store.setSubscriptions([]);

  await handleCallbackQuery({ id: '1', data: 'sub|VIV|157699|5785', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

  const last = sent[sent.length - 1];
  assert.equal(last.method, 'sendMessage');
  assert.ok(last.payload.text.includes('今日额度已尽，已进入监控，放票后会立刻提醒'), 'the warning must ride the confirmation');
});

test('a stale del button reports the miss instead of confirming a removal', async (t) => {
  isolate(t);
  const writes = mockWrites(t);
  const { sent } = mockAxios(t);
  const other = { sessionId: '111', cinemaId: 'VIV', movieTitle: 'Keep', showTime: '10:00', targetCodes: ['5785'], targetDetails: {}, alerted: false, alertedCodes: [], failCount: 0 };
  store.setSubscriptions([other]);

  await handleCallbackQuery({ id: '1', data: 'del|VIV|999', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

  assert.deepEqual(store.getSubscriptions(), [other]);
  assert.equal(writes.length, 0, 'nothing changed, nothing to save');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'answerCallbackQuery');
  assert.equal(sent[0].payload.text, '该场次已不在监控列表中');
  assert.equal(sent[0].payload.show_alert, true);
});

test('a failed save in a callback still answers, warns, and is retried by the next probe cycle', async (t) => {
  isolate(t);
  const { runProbeCycle } = require('../src/probe.js');
  let failing = true;
  const writes = [];
  t.mock.method(fs, 'writeFileSync', (file, data) => {
    if (failing) throw new Error('ENOSPC');
    writes.push(data);
  });
  t.mock.method(fs, 'renameSync', () => {});
  t.mock.method(console, 'error', () => {});
  const { sent } = mockAxios(t);
  store.setSubscriptions([
    { sessionId: '157699', cinemaId: 'VIV', movieTitle: 'Spider Man', showTime: '20:30', targetCodes: ['5785'], targetDetails: {}, alerted: false, alertedCodes: [], failCount: 0 }
  ]);

  await handleCallbackQuery({ id: '1', data: 'del|VIV|157699', message: { message_id: 2, chat: { id: TG_CHAT_ID } } });

  assert.deepEqual(store.getSubscriptions(), []);
  assert.ok(sent.some((c) => c.method === 'answerCallbackQuery'), 'the button spinner is released');
  assert.match(lastSend(sent).payload.text, /^🗑️ <b>已成功移除:<\/b> 《Spider Man》/);
  assert.match(lastSend(sent).payload.text, /写入磁盘失败/);
  assert.equal(store.hasPendingSave(), true);

  failing = false;
  await runProbeCycle();
  assert.equal(writes.length, 1, 'the probe cycle retries the handler save');
  assert.equal(JSON.parse(writes[0]).length, 0);
  assert.equal(store.hasPendingSave(), false);
});

test('a typed title containing a hyphen matches the hyphenated catalogue name', async (t) => {
  isolate(t);
  mockWrites(t);
  const { fetchMovieByItemKey } = require('../src/tgv-api.js');
  mockAxios(t, {
    moviesession_getcinemamovies: { data: { results: { movieidlist: ['uuid-1'] } } },
    moviesession_get: { data: { results: { movies: [{ recid: 'uuid-1', name: 'Spider-Man: Brand New Day', itemkey: 'spider-man-brand-new-day' }] } } }
  });

  for (const typed of ['Spider-Man', 'spider man', 'spider-man-brand']) {
    assert.deepEqual(await fetchMovieByItemKey(typed), { movieId: 'uuid-1', name: 'Spider-Man: Brand New Day' }, typed);
  }
  assert.equal(await fetchMovieByItemKey('-'), null, 'a bare dash must not match every title');
});

test('the dashboard hides the per-order cap for a sold-out promo and shows it while on sale', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sendRealtimeDashboard } = require('../src/views.js');
  const { sent } = mockAxios(t, {
    moviesession_gettickets: { data: { results: { tickets: [
      { ticketTypeCode: '5785', description: 'Promo', priceInCents: 600, quantityAvailablePerOrder: 20, longDescription: "Today's Promotion Limit Reached" },
      { ticketTypeCode: '0001', description: 'Adult', priceInCents: 2000, quantityAvailablePerOrder: 10, longDescription: '' }
    ] } } }
  });
  store.setSubscriptions([
    { sessionId: '157699', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', targetCodes: ['5785', '0001'], targetDetails: {}, alerted: false, alertedCodes: [], failCount: 0 }
  ]);

  await sendRealtimeDashboard();

  const text = lastSend(sent).payload.text;
  assert.match(text, /<b>Promo<\/b> \(RM6\): 🔴 额度已尽\n/);
  assert.match(text, /<b>Adult<\/b> \(RM20\): 🟢 <b>有票可抢<\/b> \[剩余: 10\]\n/);
});

test('a sub deleted while its probe fetch fails earns no strike and no removal notice', async (t) => {
  isolate(t);
  mockWrites(t);
  const { runProbeCycle } = require('../src/probe.js');
  t.mock.method(console, 'error', () => {});
  const sent = [];
  const sub = { sessionId: '157699', cinemaId: 'VIV', movieTitle: 'M', showTime: '20:30', targetCodes: ['5785'], targetDetails: {}, alerted: false, alertedCodes: [], failCount: 14 };
  store.setSubscriptions([sub]);
  t.mock.method(axios, 'post', async (url, data) => {
    if (url.includes('api.telegram.org')) {
      sent.push(data);
      return { data: { ok: true, result: {} } };
    }
    store.setSubscriptions([]); // /del lands mid-fetch
    throw new Error('timeout');
  });

  await runProbeCycle();

  assert.equal(sub.failCount, 14);
  assert.equal(sent.length, 0, 'no auto-removal notice for a sub the user already deleted');
});
