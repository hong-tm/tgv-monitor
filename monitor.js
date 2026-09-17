const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

// === Telegram 配置 ===
const TG_BOT_TOKEN = '***REDACTED-TOKEN***';
const TG_CHAT_ID = '***REDACTED-CHAT-ID***';
const CHECK_INTERVAL_MS = 60 * 1000;
const DATA_FILE = path.join(__dirname, 'subscriptions.json');

const sessionCache = new Map();

// === Telegram 原生 API 封装 ===
async function callTgApi(method, data = {}) {
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`;
  try {
    const res = await axios.post(url, data, { timeout: 35000 });
    return res.data;
  } catch (err) {
    console.error(`[TG API Error - ${method}]:`, err.response?.data || err.message);
    return null;
  }
}

async function notifyUser(text, replyMarkup = null) {
  const payload = {
    chat_id: TG_CHAT_ID,
    text: text,
    parse_mode: 'HTML'
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await callTgApi('sendMessage', payload);
}

async function setupBotCommands() {
  await callTgApi('setMyCommands', {
    commands: [
      { command: 'uuid', description: '查电影 UUID 与全天排片' },
      { command: 'check', description: '实时票况看板（一键刷新）' },
      { command: 'list', description: '查看已订阅任务列表' },
      { command: 'del', description: '按电影名删除场次' },
      { command: 'status', description: '查看系统健康状态' }
    ],
    scope: { type: 'default' }
  });
}

function loadSubscriptions() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = [];
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveSubscriptions(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let subscriptions = loadSubscriptions();

function generateUserSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

function getTodayBusinessDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
}

const COMMON_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'origin': 'https://www.tgv.com.my',
  'referer': 'https://www.tgv.com.my/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0 Safari/537.36'
};

// 1. 通过 itemkey 获取电影详情与 UUID
async function fetchMovieByItemKey(itemKey) {
  const cleanKey = itemKey.trim().toLowerCase();
  const endpoints = [
    { url: 'https://api.tgv.com.my/api/content/v1/movie_getbyitemkey', payload: { itemkey: cleanKey } },
    { url: 'https://api.tgv.com.my/api/content/v1/movie_getdetails', payload: { itemkey: cleanKey } }
  ];

  for (const ep of endpoints) {
    try {
      const res = await axios.post(ep.url, ep.payload, { headers: COMMON_HEADERS, timeout: 8000 });
      const movie = res.data?.results?.movie || res.data?.results;
      if (movie?.recid) {
        return { movieId: movie.recid, name: movie.name || cleanKey };
      }
    } catch (e) {}
  }

  try {
    const listRes = await axios.post('https://api.tgv.com.my/api/content/v1/movies_getnowshowing', { cinemaid: 'VIV' }, { headers: COMMON_HEADERS, timeout: 8000 });
    const movies = listRes.data?.results?.movies || [];
    const matched = movies.find(m => m.itemkey?.toLowerCase() === cleanKey || m.name?.toLowerCase().includes(cleanKey.replace(/-/g, ' ')));
    if (matched?.recid) {
      return { movieId: matched.recid, name: matched.name };
    }
  } catch (e) {}

  return null;
}

// 2. 获取指定日期、指定影院的全天排片场次
async function fetchMovieSessions(movieId, cinemaId = 'VIV', date = null) {
  const businessDate = date || getTodayBusinessDate();
  const url = 'https://api.tgv.com.my/api/boxoffice/v1/moviesession_get';
  const payload = {
    cinemaid: cinemaId,
    businessdate: businessDate,
    movieid: movieId
  };

  try {
    const res = await axios.post(url, payload, { headers: COMMON_HEADERS, timeout: 8000 });
    const movieMeta = res.data?.results?.movies?.[0] || {};
    const movieName = movieMeta.name || '未知电影';
    const cinemaNode = res.data?.results?.businessday?.cinemas?.[0];
    const sessionsList = [];

    if (cinemaNode?.movies) {
      for (const m of cinemaNode.movies) {
        if (m.experiences) {
          for (const exp of m.experiences) {
            if (exp.sessions) {
              for (const s of exp.sessions) {
                const timeStr = s.showtimemy ? s.showtimemy.substring(11, 16) : '未知时间';
                sessionsList.push({
                  sessionId: String(s.sessionid),
                  screen: s.screenname,
                  time: timeStr,
                  showTimeMy: s.showtimemy
                });
              }
            }
          }
        }
      }
    }

    return { movieName, businessDate, sessions: sessionsList };
  } catch (e) {
    return null;
  }
}

// 3. 获取具体场次票种
async function fetchTickets(cinemaId, sessionId, areaCategory = '0000000009') {
  const url = 'https://api.tgv.com.my/api/boxoffice/v1/moviesession_gettickets';
  const payload = {
    cinemaid: cinemaId,
    sessionid: sessionId,
    areacategorycodes: areaCategory,
    usersessionid: generateUserSessionId(),
    usetemplateuser: true
  };

  const res = await axios.post(url, payload, { headers: COMMON_HEADERS, timeout: 8000 });
  return res.data?.results?.tickets || [];
}

// 展示排片面板
async function showSessionsByMovieId(movieId, cinemaId = 'VIV', targetDate = null, movieNameFallback = null) {
  const date = targetDate || getTodayBusinessDate();
  await notifyUser(`🔍 正在检索电影 UUID <code>${movieId}</code> 在 <code>${date}</code> 的排片...`);
  const data = await fetchMovieSessions(movieId, cinemaId, date);

  const movieName = data?.movieName || movieNameFallback || '未知电影';
  const sessions = data?.sessions || [];

  if (sessions.length === 0) {
    return await notifyUser(
      `🎬 <b>电影:</b> 《${movieName}》\n` +
      `🆔 <b>Movie UUID:</b> <code>${movieId}</code>\n` +
      `📅 <b>日期:</b> <code>${date}</code> | 影院: ${cinemaId}\n\n` +
      `⚠️ 接口暂无此日期的场次排片数据（可能尚未开售或已过映）。`
    );
  }

  const keyboard = [];
  let row = [];
  for (const s of sessions) {
    row.push({
      text: `🕒 ${s.time} (${s.screen})`,
      callback_data: `pick_${cinemaId}_${s.sessionId}_${encodeURIComponent(movieName)}_${s.time}`
    });
    if (row.length === 2) {
      keyboard.push(row);
      row = [];
    }
  }
  if (row.length > 0) keyboard.push(row);

  const msg = `🎬 <b>电影:</b> 《${movieName}》\n` +
              `🆔 <b>Movie UUID:</b> <code>${movieId}</code>\n` +
              `📅 <b>排片日期:</b> <code>${date}</code>\n` +
              `📍 <b>影院:</b> ${cinemaId} | 当天共有 <b>${sessions.length}</b> 个场次\n\n` +
              `👇 <b>请点击开场时间直接锁定监控：</b>`;

  return await notifyUser(msg, { inline_keyboard: keyboard });
}

// 展示票种选择
async function showTicketSelection(cinemaId, sessionId, movieName, showTime) {
  await notifyUser(`⏳ 正在读取 <b>《${movieName}》</b> (场次 <code>${sessionId}</code>) 的可用票种...`);

  try {
    const tickets = await fetchTickets(cinemaId, sessionId);
    if (!tickets || tickets.length === 0) {
      return await notifyUser(`❌ 无法获取场次 <code>${sessionId}</code> 的票种数据，可能已停售。`);
    }

    sessionCache.set(`${cinemaId}_${sessionId}`, { movieName, showTime, tickets });

    const inlineKeyboard = [];
    for (const t of tickets) {
      const code = String(t.ticketTypeCode);
      const name = t.description;
      const price = t.priceInCents / 100;
      const quota = t.quantityAvailablePerOrder;
      const isPromo = t.descriptionAlt?.includes('PROMO') || t.longDescription?.includes('Limit Reached');

      inlineKeyboard.push([{
        text: `${isPromo ? '🔥' : '🎟️'} ${name} (RM${price}) [剩余:${quota}]`,
        callback_data: `sub_${cinemaId}_${sessionId}_${code}`
      }]);
    }

    inlineKeyboard.unshift([{
      text: '⚡ 一键监控该场次全部促销票 (Promo Only)',
      callback_data: `suball_${cinemaId}_${sessionId}`
    }]);

    const msg = `🎬 <b>《${movieName}》</b> ${showTime ? `(<code>${showTime}</code>)` : ''}\n` +
                `📍 影院: ${cinemaId} | 场次 ID: <code>${sessionId}</code>\n` +
                `───────────────────\n` +
                `👇 <b>点击锁定要监控的票种：</b>`;

    return await notifyUser(msg, { inline_keyboard: inlineKeyboard });
  } catch (e) {
    return await notifyUser(`❌ 探测票种失败: ${e.message}`);
  }
}

// 智能总路由
async function handleSmartInput(text, defaultCinemaId = 'VIV') {
  const isExplicitUuidCmd = /^\/?uuid\b/i.test(text.trim()) || /@\w+\s+uuid\b/i.test(text.trim());

  // 清洗参数：去掉 @bot、命令前缀
  let input = text.trim()
    .replace(/^@\w+\s*/i, '')
    .replace(/^\/?(uuid|add)\s*/i, '')
    .trim();

  if (!input) {
    const markup = {
      inline_keyboard: [
        [{ text: '✍️ 点击自动填入 /uuid 并预留空格', switch_inline_query_current_chat: 'uuid ' }]
      ]
    };
    return await notifyUser(
      '🆔 <b>按 Movie UUID / 链接 查询排片</b>\n\n' +
      '请在指令后直接附带 <b>电影链接</b>、<b>别名</b> 或 <b>36 位 UUID</b>。',
      markup
    );
  }

  // 1. 如果是选座直链：/select-seats/{itemkey}/{date}/{cinema}/{sessionid}
  if (input.includes('/select-seats/')) {
    const parts = input.split('/');
    const sessionId = parts[parts.length - 1];
    const cinemaId = parts[parts.length - 2] || defaultCinemaId;
    const targetDate = parts[parts.length - 3]; // 提取链接里的日期如 2026-09-08
    const itemKey = parts[parts.length - 4] || '';
    const movieName = decodeURIComponent(itemKey).replace(/-/g, ' ');

    // 如果用户明确使用了 /uuid 指令，或者需要查整部排片：直接反查 UUID 并拉取当天排片
    if (isExplicitUuidCmd) {
      await notifyUser(`🎯 正在从选座链接解析电影别名 <code>${itemKey}</code> 与排片日期 <code>${targetDate}</code>...`);
      const movieInfo = await fetchMovieByItemKey(itemKey);
      if (movieInfo) {
        return await showSessionsByMovieId(movieInfo.movieId, cinemaId, targetDate, movieInfo.name);
      }
    }

    // 若不是 /uuid 指令，则提供两个选项让用户选
    const movieInfo = itemKey ? await fetchMovieByItemKey(itemKey) : null;
    const uuidText = movieInfo ? `\n🆔 <b>Movie UUID:</b> <code>${movieInfo.movieId}</code>` : '';

    const markup = {
      inline_keyboard: [
        ...(movieInfo ? [[{ text: `📅 查看当天 (${targetDate}) 全部排片`, callback_data: `showall_${cinemaId}_${movieInfo.movieId}_${targetDate}` }]] : []),
        [{ text: `🎟️ 直接监控当前场次 (${sessionId})`, callback_data: `quicksub_${cinemaId}_${sessionId}_${encodeURIComponent(movieName)}` }]
      ]
    };

    return await notifyUser(
      `🎯 <b>已识别电影:</b> 《${movieName}》${uuidText}\n` +
      `📍 <b>影院:</b> ${cinemaId} | <b>排片日期:</b> <code>${targetDate}</code>\n` +
      `🎫 <b>目标场次:</b> <code>${sessionId}</code>\n\n` +
      `👇 <b>请选择操作：</b>`,
      markup
    );
  }

  // 2. 电影详情链接：/movies/details/{itemkey}
  if (input.includes('/movies/details/') || input.includes('/movies/')) {
    const match = input.match(/\/movies\/(?:details\/)?([^\/?#]+)/i);
    if (match && match[1]) {
      const itemKey = match[1];
      await notifyUser(`🔎 正在解析电影别名: <code>${itemKey}</code>`);
      const movieInfo = await fetchMovieByItemKey(itemKey);
      if (movieInfo) {
        return await showSessionsByMovieId(movieInfo.movieId, defaultCinemaId, null, movieInfo.name);
      }
    }
  }

  // 3. 包含标准的 36 位 UUID
  const uuidMatch = input.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch) {
    return await showSessionsByMovieId(uuidMatch[0], defaultCinemaId);
  }

  // 4. 纯数字场次号
  if (/^\d{5,8}$/.test(input)) {
    return await showTicketSelection(defaultCinemaId, input, `场次 ${input}`, '');
  }

  // 5. itemkey 连字符别名（如 spider-man-brand-new-day）
  if (/^[a-z0-9-]+$/.test(input) && input.includes('-')) {
    await notifyUser(`🔎 正在根据别名检索: <code>${input}</code>`);
    const movieInfo = await fetchMovieByItemKey(input);
    if (movieInfo) {
      return await showSessionsByMovieId(movieInfo.movieId, defaultCinemaId, null, movieInfo.name);
    }
  }

  // 6. 纯文本输入搜索
  await notifyUser(`🔎 正在搜索电影：<b>${input}</b>`);
  const movieInfo = await fetchMovieByItemKey(input);
  if (movieInfo) {
    return await showSessionsByMovieId(movieInfo.movieId, defaultCinemaId, null, movieInfo.name);
  }

  return await notifyUser(`❌ 未能匹配到电影《${input}》，若该片尚未定档或放排片，TGV 系统内暂无记录。`);
}

// 消息监听
async function handleMessage(msg) {
  if (!msg || !msg.text) return;
  if (String(msg.chat.id) !== String(TG_CHAT_ID)) return;

  const text = msg.text.trim();

  if (text.startsWith('/start')) {
    const help = `🎬 <b>TGV 极速抢票监控系统</b>\n\n` +
                 `快捷指令：\n` +
                 `🔹 <code>/uuid &lt;链接或UUID&gt;</code> - 查 UUID 并列出全天排片\n` +
                 `🔹 <code>/check</code> - 实时票况看板（支持原地刷新）\n` +
                 `🔹 <code>/list</code> - 查看监控列表\n` +
                 `🔹 <code>/del</code> - 选择删除已监控场次\n` +
                 `🔹 <code>/status</code> - 运行健康状况\n\n` +
                 `直接发送任意选座直链、电影链接或电影名均可智能处理。`;
    return await notifyUser(help);
  }

  if (text.startsWith('/status')) {
    const now = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' });
    return await notifyUser(`🟢 <b>系统正常运行中</b>\n当前时间: <code>${now}</code>\n监控中场次: <b>${subscriptions.length}</b> 个`);
  }

  if (text.startsWith('/list')) {
    if (subscriptions.length === 0) {
      return await notifyUser('ℹ️ 当前无监控任务。直接发送电影链接或编号即可添加。');
    }
    let reply = `📋 <b>当前监控任务列表 (${subscriptions.length})：</b>\n\n`;
    for (const s of subscriptions) {
      const codeNames = s.targetCodes.map(c => s.targetDetails?.[c]?.name || c).join('\n  • ');
      reply += `🎬 <b>《${s.movieTitle || '未知电影'}》</b>\n` +
               `⏰ 时间: <code>${s.showTime || '未记录'}</code> | 影院: ${s.cinemaId} (ID: <code>${s.sessionId}</code>)\n` +
               `🎯 监控票种:\n  • ${codeNames}\n` +
               `🔔 状态: ${s.alerted ? '🚨 已报警' : '💤 静默轮询中'}\n` +
               `───────────────────\n`;
    }
    return await notifyUser(reply);
  }

  if (text.startsWith('/check')) {
    return await sendRealtimeDashboard();
  }

  if (text.startsWith('/del')) {
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const targetId = parts[1];
      const lenBefore = subscriptions.length;
      subscriptions = subscriptions.filter(s => s.sessionId !== targetId);
      if (subscriptions.length < lenBefore) {
        saveSubscriptions(subscriptions);
        return await notifyUser(`🗑️ 已移除场次 <code>${targetId}</code>。`);
      } else {
        return await notifyUser(`⚠️ 未在列表中找到场次 <code>${targetId}</code>。`);
      }
    } else {
      if (subscriptions.length === 0) {
        return await notifyUser('ℹ️ 当前无监控任务，无需删除。');
      }
      const delButtons = subscriptions.map(s => ([{
        text: `❌ 删除: 《${s.movieTitle || '未知'}》 (${s.showTime || s.sessionId})`,
        callback_data: `del_${s.sessionId}`
      }]));

      return await notifyUser('🗑️ <b>请点击下方按钮选择要删除的场次：</b>', {
        inline_keyboard: delButtons
      });
    }
  }

  // 统一送入智能解析
  await handleSmartInput(text);
}

// 实时看板
async function sendRealtimeDashboard(messageIdToEdit = null) {
  if (subscriptions.length === 0) {
    const emptyMsg = 'ℹ️ 当前无监控任务。';
    if (messageIdToEdit) {
      return await callTgApi('editMessageText', { chat_id: TG_CHAT_ID, message_id: messageIdToEdit, text: emptyMsg });
    }
    return await notifyUser(emptyMsg);
  }

  const now = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' });
  let text = `📊 <b>TGV 实时票况看板</b>\n更新时间: <code>${now}</code>\n───────────────────\n`;

  for (const s of subscriptions) {
    text += `🎬 <b>《${s.movieTitle || '未知电影'}》</b> (${s.showTime || ''})\n` +
            `📍 影院: ${s.cinemaId} | 场次: <code>${s.sessionId}</code>\n`;
    try {
      const tickets = await fetchTickets(s.cinemaId, s.sessionId, s.areaCategory);
      for (const code of s.targetCodes) {
        const t = tickets.find(item => String(item.ticketTypeCode) === code);
        if (!t) {
          text += `  • <code>${code}</code>: <i>未在售/已下架</i>\n`;
          continue;
        }
        const quota = t.quantityAvailablePerOrder;
        const limitReached = t.longDescription && t.longDescription.includes("Today's Promotion Limit Reached");
        const statusIcon = (quota > 0 && !limitReached) ? '🟢 <b>有票可抢</b>' : '🔴 额度已尽';
        text += `  • <b>${t.description}</b> (RM${t.priceInCents / 100}): ${statusIcon} [剩余: ${quota}]\n`;
      }
    } catch (e) {
      text += `  • <i>请求失败: ${e.message}</i>\n`;
    }
    text += `───────────────────\n`;
  }

  const markup = {
    inline_keyboard: [[
      { text: '🔄 立即刷新最新状态', callback_data: 'refresh_dashboard' }
    ]]
  };

  if (messageIdToEdit) {
    await callTgApi('editMessageText', {
      chat_id: TG_CHAT_ID,
      message_id: messageIdToEdit,
      text: text,
      parse_mode: 'HTML',
      reply_markup: markup
    });
  } else {
    await notifyUser(text, markup);
  }
}

// 按钮回调处理
async function handleCallbackQuery(cb) {
  if (!cb || !cb.data) return;
  const data = cb.data;
  const msgId = cb.message?.message_id;

  if (data === 'refresh_dashboard') {
    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '正在刷新...' });
    return await sendRealtimeDashboard(msgId);
  }

  // 展开某天整部电影所有排片
  if (data.startsWith('showall_')) {
    const [, cinemaId, movieId, targetDate] = data.split('_');
    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '加载排片中...' });
    return await showSessionsByMovieId(movieId, cinemaId, targetDate);
  }

  // 快速进入单场票种选择
  if (data.startsWith('quicksub_')) {
    const [, cinemaId, sessionId, encodedName] = data.split('_');
    const movieName = decodeURIComponent(encodedName);
    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '加载票种中...' });
    return await showTicketSelection(cinemaId, sessionId, movieName, '');
  }

  if (data.startsWith('pick_')) {
    const [, cinemaId, sessionId, encodedName, showTime] = data.split('_');
    const movieName = decodeURIComponent(encodedName);
    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `已选 ${showTime}` });
    return await showTicketSelection(cinemaId, sessionId, movieName, showTime);
  }

  if (data.startsWith('del_')) {
    const sessionId = data.replace('del_', '');
    const target = subscriptions.find(s => s.sessionId === sessionId);
    const movieName = target?.movieTitle || sessionId;

    subscriptions = subscriptions.filter(s => s.sessionId !== sessionId);
    saveSubscriptions(subscriptions);

    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `已移除《${movieName}》` });
    return await notifyUser(`🗑️ <b>已成功移除:</b> 《${movieName}》 (场次 <code>${sessionId}</code>)`);
  }

  if (data.startsWith('suball_')) {
    const [, cinemaId, sessionId] = data.split('_');
    const cached = sessionCache.get(`${cinemaId}_${sessionId}`);
    const movieName = cached?.movieName || '电影';
    const showTime = cached?.showTime || '';
    const tickets = cached?.tickets || await fetchTickets(cinemaId, sessionId);

    const promoTickets = tickets.filter(t => 
      t.descriptionAlt?.includes('PROMO') || 
      t.longDescription?.includes('Limit Reached') ||
      ['5785', '5759', '6336'].includes(String(t.ticketTypeCode))
    );

    if (promoTickets.length === 0) {
      return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '未检测到促销票种', show_alert: true });
    }

    let sub = subscriptions.find(s => s.sessionId === sessionId && s.cinemaId === cinemaId);
    if (!sub) {
      sub = {
        sessionId,
        cinemaId,
        movieTitle: movieName,
        showTime: showTime,
        areaCategory: '0000000009',
        targetCodes: [],
        targetDetails: {},
        alerted: false,
        failCount: 0
      };
      subscriptions.push(sub);
    } else {
      sub.movieTitle = movieName;
      sub.showTime = showTime;
    }

    for (const pt of promoTickets) {
      const code = String(pt.ticketTypeCode);
      if (!sub.targetCodes.includes(code)) {
        sub.targetCodes.push(code);
        sub.targetDetails[code] = { name: pt.description, price: pt.priceInCents / 100 };
      }
    }
    saveSubscriptions(subscriptions);

    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '已订阅促销票！' });
    return await notifyUser(`✅ <b>《${movieName}》已添加促销票监控！</b>\n时间: <code>${showTime}</code>\n包含票种:\n• ` + promoTickets.map(p => p.description).join('\n• '));
  }

  if (data.startsWith('sub_')) {
    const [, cinemaId, sessionId, targetCode] = data.split('_');
    const cached = sessionCache.get(`${cinemaId}_${sessionId}`);
    const movieName = cached?.movieName || '电影';
    const showTime = cached?.showTime || '';
    const tickets = cached?.tickets || await fetchTickets(cinemaId, sessionId);
    const targetTicket = tickets.find(t => String(t.ticketTypeCode) === targetCode);

    if (!targetTicket) {
      return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '票种已失效', show_alert: true });
    }

    let sub = subscriptions.find(s => s.sessionId === sessionId && s.cinemaId === cinemaId);
    if (!sub) {
      sub = {
        sessionId,
        cinemaId,
        movieTitle: movieName,
        showTime: showTime,
        areaCategory: '0000000009',
        targetCodes: [],
        targetDetails: {},
        alerted: false,
        failCount: 0
      };
      subscriptions.push(sub);
    } else {
      sub.movieTitle = movieName;
      sub.showTime = showTime;
    }

    if (sub.targetCodes.includes(targetCode)) {
      return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '已在监控中', show_alert: true });
    }

    sub.targetCodes.push(targetCode);
    sub.targetDetails[targetCode] = {
      name: targetTicket.description,
      price: targetTicket.priceInCents / 100
    };
    saveSubscriptions(subscriptions);

    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `已添加 ${targetTicket.description}` });
    return await notifyUser(`✅ <b>订阅成功！</b>\n电影: <b>《${movieName}》</b>\n票种: <b>${targetTicket.description}</b> (RM${targetTicket.priceInCents / 100})`);
  }
}

// Telegram 长轮询
let lastUpdateId = 0;
async function startTelegramPolling() {
  while (true) {
    try {
      const res = await callTgApi('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 30
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          lastUpdateId = update.update_id;
          if (update.message) {
            await handleMessage(update.message);
          } else if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
          }
        }
      }
    } catch (err) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// 探测轮询
async function runProbeCycle() {
  const now = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' });
  let dirty = false;

  for (let i = subscriptions.length - 1; i >= 0; i--) {
    const sub = subscriptions[i];

    try {
      const tickets = await fetchTickets(sub.cinemaId, sub.sessionId, sub.areaCategory);
      sub.failCount = 0;

      if (!tickets || tickets.length === 0) continue;

      let hasAvailableQuota = false;
      let matchedDescriptions = [];

      for (const t of tickets) {
        if (sub.targetCodes.includes(String(t.ticketTypeCode))) {
          const quota = t.quantityAvailablePerOrder;
          const limitReached = t.longDescription && t.longDescription.includes("Today's Promotion Limit Reached");

          if (quota > 0 && !limitReached) {
            hasAvailableQuota = true;
            matchedDescriptions.push(`🎫 <b>${t.description}</b> (剩余: ${quota} 张 | RM${t.priceInCents / 100})`);
          }
        }
      }

      if (hasAvailableQuota) {
        if (!sub.alerted) {
          sub.alerted = true;
          dirty = true;
          const alertMsg = `🎉 <b>TGV 放票通知！</b>\n\n` +
                           `电影: <b>《${sub.movieTitle || '电影'}》</b>\n` +
                           `时间: <code>${sub.showTime || ''}</code>\n` +
                           `影院: <b>${sub.cinemaId}</b> | 场次: <code>${sub.sessionId}</code>\n\n` +
                           matchedDescriptions.join('\n') + `\n\n` +
                           `⏰ 触发时间: <code>${now}</code>\n` +
                           `👉 立即前往 TGV 结账！`;
          await notifyUser(alertMsg, {
            inline_keyboard: [[{ text: '🔍 查看当前票况', callback_data: 'refresh_dashboard' }]]
          });
        }
      } else {
        if (sub.alerted) {
          sub.alerted = false;
          dirty = true;
        }
      }

    } catch (err) {
      sub.failCount = (sub.failCount || 0) + 1;
      if (sub.failCount >= 15) {
        await notifyUser(`⚠️ <b>场次自动失效提醒</b>\n电影《${sub.movieTitle || sub.sessionId}》场次已下线，已自动移出监控。`);
        subscriptions.splice(i, 1);
        dirty = true;
      }
    }
  }

  if (dirty) {
    saveSubscriptions(subscriptions);
  }
}

async function main() {
  console.log('TGV 智能排片系统已修正启动...');
  await setupBotCommands();
  await notifyUser('🤖 <b>TGV 监控系统已针对 /uuid 与排片日期修正完毕！</b>');

  startTelegramPolling();
  runProbeCycle();
  setInterval(runProbeCycle, CHECK_INTERVAL_MS);
}

main();
