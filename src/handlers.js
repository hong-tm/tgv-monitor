const { notifyUser, callTgApi } = require('./telegram');
const { fetchMovieByItemKey, fetchTickets } = require('./tgv-api');
const { getSubscriptions, setSubscriptions, saveSubscriptions, sessionCache, cacheSession, upsertSubscription } = require('./store');
const { parseCallback } = require('./payload');
const { showSessionsByMovieId, showTicketSelection, sendRealtimeDashboard, sendHelp, sendSubscriptionList } = require('./views');
const { escapeHtml } = require('./util');
const { TG_CHAT_ID, PROMO_TICKET_CODES } = require('./config');
const { classifyInput } = require('./input-classifier');

async function handleSmartInput(text, defaultCinemaId = 'VIV') {
  const c = classifyInput(text, defaultCinemaId);

  if (c.kind === 'empty') {
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

  if (c.kind === 'seat-link') {
    const { itemKey, movieName, cinemaId, sessionId, targetDate, isExplicitUuidCmd } = c;

    if (isExplicitUuidCmd) {
      await notifyUser(`🎯 正在从选座链接解析电影别名 <code>${escapeHtml(itemKey)}</code> 与排片日期 <code>${escapeHtml(targetDate)}</code>...`);
      const movieInfo = await fetchMovieByItemKey(itemKey);
      if (movieInfo) {
        return await showSessionsByMovieId(movieInfo.movieId, cinemaId, targetDate, movieInfo.name);
      }
    }

    const movieInfo = itemKey ? await fetchMovieByItemKey(itemKey) : null;
    const uuidText = movieInfo ? `\n🆔 <b>Movie UUID:</b> <code>${escapeHtml(movieInfo.movieId)}</code>` : '';

    cacheSession(`${cinemaId}_${sessionId}`, { movieName, showTime: '' });

    const markup = {
      inline_keyboard: [
        ...(movieInfo ? [[{ text: `📅 查看当天 (${targetDate}) 全部排片`, callback_data: `showall|${cinemaId}|${movieInfo.movieId}|${targetDate}` }]] : []),
        [{ text: `🎟️ 直接监控当前场次 (${sessionId})`, callback_data: `quicksub|${cinemaId}|${sessionId}` }]
      ]
    };

    return await notifyUser(
      `🎯 <b>已识别电影:</b> 《${escapeHtml(movieName)}》${uuidText}\n` +
      `📍 <b>影院:</b> ${escapeHtml(cinemaId)} | <b>排片日期:</b> <code>${escapeHtml(targetDate)}</code>\n` +
      `🎫 <b>目标场次:</b> <code>${escapeHtml(sessionId)}</code>\n\n` +
      `👇 <b>请选择操作：</b>`,
      markup
    );
  }

  if (c.kind === 'movie-link') {
    await notifyUser(`🔎 正在解析电影别名: <code>${escapeHtml(c.itemKey)}</code>`);
    const movieInfo = await fetchMovieByItemKey(c.itemKey);
    if (movieInfo) {
      return await showSessionsByMovieId(movieInfo.movieId, defaultCinemaId, null, movieInfo.name);
    }
  }

  if (c.kind === 'uuid') {
    return await showSessionsByMovieId(c.uuid, defaultCinemaId);
  }

  if (c.kind === 'session') {
    return await showTicketSelection(defaultCinemaId, c.input, `场次 ${c.input}`, '');
  }

  if (c.kind === 'alias') {
    await notifyUser(`🔎 正在根据别名检索: <code>${escapeHtml(c.input)}</code>`);
    const movieInfo = await fetchMovieByItemKey(c.input);
    if (movieInfo) {
      return await showSessionsByMovieId(movieInfo.movieId, defaultCinemaId, null, movieInfo.name);
    }
  }

  await notifyUser(`🔎 正在搜索电影：<b>${escapeHtml(c.input)}</b>`);
  const movieInfo = await fetchMovieByItemKey(c.input);
  if (movieInfo) {
    return await showSessionsByMovieId(movieInfo.movieId, defaultCinemaId, null, movieInfo.name);
  }

  return await notifyUser(`❌ 未能匹配到电影《${escapeHtml(c.input)}》，若该片尚未定档或放排片，TGV 系统内暂无记录。`);
}

async function handleMessage(msg) {
  if (!msg || !msg.text) return;
  if (String(msg.chat.id) !== String(TG_CHAT_ID)) return;

  const text = msg.text.trim();

  if (text.startsWith('/start')) {
    return await sendHelp();
  }

  if (text.startsWith('/status')) {
    const now = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' });
    return await notifyUser(`🟢 <b>系统正常运行中</b>\n当前时间: <code>${escapeHtml(now)}</code>\n监控中场次: <b>${getSubscriptions().length}</b> 个`);
  }

  if (text.startsWith('/list')) {
    return await sendSubscriptionList();
  }

  if (text.startsWith('/check')) {
    return await sendRealtimeDashboard();
  }

  if (text.startsWith('/del')) {
    const parts = text.split(/\s+/);
    if (parts.length > 1) {
      const targetId = parts[1];
      const lenBefore = getSubscriptions().length;
      setSubscriptions(getSubscriptions().filter(s => s.sessionId !== targetId));
      if (getSubscriptions().length < lenBefore) {
        saveSubscriptions(getSubscriptions());
        return await notifyUser(`🗑️ 已移除场次 <code>${escapeHtml(targetId)}</code>。`);
      } else {
        return await notifyUser(`⚠️ 未在列表中找到场次 <code>${escapeHtml(targetId)}</code>。`);
      }
    } else {
      if (getSubscriptions().length === 0) {
        return await notifyUser('ℹ️ 当前无监控任务，无需删除。');
      }
      const delButtons = getSubscriptions().map(s => ([{
        text: `❌ 删除: 《${s.movieTitle || '未知'}》 (${s.showTime || s.sessionId})`,
        callback_data: `del|${s.sessionId}`
      }]));

      return await notifyUser('🗑️ <b>请点击下方按钮选择要删除的场次：</b>', {
        inline_keyboard: delButtons
      });
    }
  }

  await handleSmartInput(text);
}

async function handleCallbackQuery(cb) {
  if (!cb || !cb.data) return;
  const msgId = cb.message?.message_id;
  const parsed = parseCallback(cb.data);

  if (!parsed) {
    return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '请重新发送电影名或链接后再试' });
  }

  const { action, args } = parsed;

  if (action === 'refresh_dashboard') {
    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '正在刷新...' });
    return await sendRealtimeDashboard(msgId);
  }

  if (action === 'showall') {
    const [cinemaId, movieId, targetDate] = args;
    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '加载排片中...' });
    return await showSessionsByMovieId(movieId, cinemaId, targetDate);
  }

  if (action === 'quicksub') {
    const [cinemaId, sessionId, legacyName] = args;
    const cached = sessionCache.get(`${cinemaId}_${sessionId}`);
    const movieName = cached?.movieName || legacyName || '电影';
    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '加载票种中...' });
    return await showTicketSelection(cinemaId, sessionId, movieName, '');
  }

  if (action === 'pick') {
    const [cinemaId, sessionId, showTime, legacyName] = args;
    const cached = sessionCache.get(`${cinemaId}_${sessionId}`);
    const movieName = cached?.movieName || legacyName || '电影';
    const finalShowTime = cached?.showTime || showTime || '';
    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `已选 ${finalShowTime}` });
    return await showTicketSelection(cinemaId, sessionId, movieName, finalShowTime);
  }

  if (action === 'del') {
    const sessionId = args[0];
    const target = getSubscriptions().find(s => s.sessionId === sessionId);
    const movieName = target?.movieTitle || sessionId;

    setSubscriptions(getSubscriptions().filter(s => s.sessionId !== sessionId));
    saveSubscriptions(getSubscriptions());

    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `已移除《${movieName}》` });
    return await notifyUser(`🗑️ <b>已成功移除:</b> 《${escapeHtml(movieName)}》 (场次 <code>${escapeHtml(sessionId)}</code>)`);
  }

  if (action === 'suball') {
    const [cinemaId, sessionId] = args;
    const cached = sessionCache.get(`${cinemaId}_${sessionId}`);
    const movieName = cached?.movieName || '电影';
    const showTime = cached?.showTime || '';
    const tickets = await fetchTickets(cinemaId, sessionId);

    const promoTickets = tickets.filter(t => 
      t.descriptionAlt?.includes('PROMO') || 
      t.longDescription?.includes('Limit Reached') ||
      PROMO_TICKET_CODES.includes(String(t.ticketTypeCode))
    );

    if (promoTickets.length === 0) {
      return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '未检测到促销票种', show_alert: true });
    }

    const sub = upsertSubscription(cinemaId, sessionId, movieName, showTime);

    for (const pt of promoTickets) {
      const code = String(pt.ticketTypeCode);
      if (!sub.targetCodes.includes(code)) {
        sub.targetCodes.push(code);
        sub.targetDetails[code] = { name: pt.description, price: pt.priceInCents / 100 };
      }
    }
    saveSubscriptions(getSubscriptions());

    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '已订阅促销票！' });
    return await notifyUser(`✅ <b>《${escapeHtml(movieName)}》已添加促销票监控！</b>\n时间: <code>${escapeHtml(showTime)}</code>\n包含票种:\n• ` + promoTickets.map(p => escapeHtml(p.description)).join('\n• '));
  }

  if (action === 'sub') {
    const [cinemaId, sessionId, targetCode] = args;
    const cached = sessionCache.get(`${cinemaId}_${sessionId}`);
    const movieName = cached?.movieName || '电影';
    const showTime = cached?.showTime || '';
    const tickets = await fetchTickets(cinemaId, sessionId);
    const targetTicket = tickets.find(t => String(t.ticketTypeCode) === targetCode);

    if (!targetTicket) {
      return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '票种已失效', show_alert: true });
    }

    const sub = upsertSubscription(cinemaId, sessionId, movieName, showTime);

    if (sub.targetCodes.includes(targetCode)) {
      return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '已在监控中', show_alert: true });
    }

    sub.targetCodes.push(targetCode);
    sub.targetDetails[targetCode] = {
      name: targetTicket.description,
      price: targetTicket.priceInCents / 100
    };
    saveSubscriptions(getSubscriptions());

    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: `已添加 ${targetTicket.description}` });
    return await notifyUser(`✅ <b>订阅成功！</b>\n电影: <b>《${escapeHtml(movieName)}》</b>\n票种: <b>${escapeHtml(targetTicket.description)}</b> (RM${targetTicket.priceInCents / 100})`);
  }

  return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '请重新发送电影名或链接后再试' });
}

module.exports = {
  handleSmartInput,
  handleMessage,
  handleCallbackQuery
};
