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

// The 19-char horizontal rule used by both /list and the /del callback copy.
const SEP = '─'.repeat(19);

// --- harness -----------------------------------------------------------------

// Snapshot + restore the live subscriptions array and the session cache so no
// test leaks state into the next one.
function isolate(t) {
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
    movie_getbyitemkey: { data: { results: { movie: { recid: 'uuid-1', name: 'Spider Man' } } } }
  });

  await handleSmartInput('https://www.tgv.com.my/select-seats/spider-man/2026-09-24/VIV/157699');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(
    sent[0].payload.text,
    '🎯 <b>已识别电影:</b> 《spider man》\n' +
      '🆔 <b>Movie UUID:</b> <code>uuid-1</code>\n' +
      '📍 <b>影院:</b> VIV | <b>排片日期:</b> <code>2026-09-24</code>\n' +
      '🎫 <b>目标场次:</b> <code>157699</code>\n\n' +
      '👇 <b>请选择操作：</b>'
  );

  const buttons = sent[0].payload.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].callback_data, 'showall|VIV|uuid-1|2026-09-24');
  assert.equal(buttons[1].callback_data, 'quicksub|VIV|157699');

  assert.deepEqual(store.sessionCache.get('VIV_157699'), { movieName: 'spider man', showTime: '' });
});

// --- 7 -----------------------------------------------------------------------

test('/uuid select-seats link sends the parse notice then lists sessions with a pick button', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t, {
    movie_getbyitemkey: { data: { results: { movie: { recid: 'uuid-1', name: 'Spider Man' } } } },
    moviesession_get: {
      data: {
        results: {
          movies: [{ name: 'X' }],
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

test('malformed percent-encoding rejects with URIError before any I/O', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent, tgvEndpoints } = mockAxios(t);

  await assert.rejects(
    () => handleSmartInput('https://x/select-seats/%zz/2026-01-01/VIV/1'),
    (e) => e instanceof URIError
  );
  assert.equal(sent.length, 0);
  assert.equal(tgvEndpoints.length, 0);
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

  await handleCallbackQuery({ id: '1', data: 'sub|VIV|157699|5785', message: { message_id: 2 } });

  assert.equal(writes.length, 1);
  const parsed = JSON.parse(writes[0].data);
  assert.deepEqual(parsed, [
    {
      sessionId: '157699',
      cinemaId: 'VIV',
      movieTitle: '电影',
      showTime: '',
      areaCategory: '0000000009',
      targetCodes: ['5785'],
      targetDetails: { 5785: { name: 'Promo A', price: 6 } },
      alerted: false,
      failCount: 0
    }
  ]);
  assert.equal(
    Object.keys(parsed[0]).join(','),
    'sessionId,cinemaId,movieTitle,showTime,areaCategory,targetCodes,targetDetails,alerted,failCount'
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

  await handleCallbackQuery({ id: '1', data: 'sub|VIV|157699|5785', message: { message_id: 2 } });

  // Early return precedes saveSubscriptions: the refresh below is NOT persisted.
  assert.equal(writes.length, 0);
  const answer = sent.find((c) => c.method === 'answerCallbackQuery');
  assert.equal(answer.payload.text, '已在监控中');
  assert.equal(answer.payload.show_alert, true);
  // Locked quirk: the in-memory title was refreshed even though nothing was saved.
  assert.equal(store.getSubscriptions()[0].movieTitle, '电影');
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

  await handleCallbackQuery({ id: '1', data: 'suball|VIV|157699', message: { message_id: 2 } });

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

  await handleCallbackQuery({ id: '1', data: 'del|157699', message: { message_id: 2 } });

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
  await handleCallbackQuery({ id: '1', data: 'pick|VIV|157699|20:30|Spider', message: { message_id: 2 } });
  assert.equal(sent.find((c) => c.method === 'answerCallbackQuery').payload.text, '已选 19:00');

  // (b) empty cache -> payload showTime
  sent.length = 0;
  store.sessionCache.delete('VIV_157699');
  await handleCallbackQuery({ id: '1', data: 'pick|VIV|157699|20:30|Spider', message: { message_id: 2 } });
  assert.equal(sent.find((c) => c.method === 'answerCallbackQuery').payload.text, '已选 20:30');

  // (c) quicksub legacy name argument
  sent.length = 0;
  await handleCallbackQuery({ id: '1', data: 'quicksub|VIV|157699|Legacy', message: { message_id: 2 } });
  assert.ok(sent.some((c) => c.method === 'sendMessage' && c.payload.text.includes('Legacy')));

  // (d) quicksub with no legacy arg -> default 电影
  sent.length = 0;
  await handleCallbackQuery({ id: '1', data: 'quicksub|VIV|157699', message: { message_id: 2 } });
  assert.ok(sent.some((c) => c.method === 'sendMessage' && c.payload.text.includes('电影')));
});

// --- 14 ----------------------------------------------------------------------

test('unknown action and unparseable payload both fall back to the retry hint', async (t) => {
  isolate(t);
  mockWrites(t);
  const { sent } = mockAxios(t);

  // parseCallback succeeds but no branch matches -> final return
  await handleCallbackQuery({ id: '1', data: 'foo|bar', message: { message_id: 2 } });
  assert.equal(lastSend(sent).payload.text, '请重新发送电影名或链接后再试');

  // parseCallback returns null -> early return
  sent.length = 0;
  await handleCallbackQuery({ id: '1', data: 'garbage', message: { message_id: 2 } });
  assert.equal(lastSend(sent).payload.text, '请重新发送电影名或链接后再试');
});
