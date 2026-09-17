const { notifyUser, callTgApi } = require('./telegram');
const { fetchMovieByItemKey, fetchTickets } = require('./tgv-api');
const { getSubscriptions, setSubscriptions, saveSubscriptions, sessionCache } = require('./store');
const { parseCallback } = require('./payload');
const { showSessionsByMovieId, showTicketSelection, sendRealtimeDashboard } = require('./views');
const { escapeHtml } = require('./util');
const { TG_CHAT_ID } = require('./config');

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
      await notifyUser(`🎯 正在从选座链接解析电影别名 <code>${escapeHtml(itemKey)}</code> 与排片日期 <code>${escapeHtml(targetDate)}</code>...`);
      const movieInfo = await fetchMovieByItemKey(itemKey);
      if (movieInfo) {
        return await showSessionsByMovieId(movieInfo.movieId, cinemaId, targetDate, movieInfo.name);
      }
    }

    // 若不是 /uuid 指令，则提供两个选项让用户选
    const movieInfo = itemKey ? await fetchMovieByItemKey(itemKey) : null;
    const uuidText = movieInfo ? `\n🆔 <b>Movie UUID:</b> <code>${escapeHtml(movieInfo.movieId)}</code>` : '';

    sessionCache.set(`${cinemaId}_${sessionId}`, { movieName, showTime: '', tickets: null });

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

  // 2. 电影详情链接：/movies/details/{itemkey}
  if (input.includes('/movies/details/') || input.includes('/movies/')) {
    const match = input.match(/\/movies\/(?:details\/)?([^\/?#]+)/i);
    if (match && match[1]) {
      const itemKey = match[1];
      await notifyUser(`🔎 正在解析电影别名: <code>${escapeHtml(itemKey)}</code>`);
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
    await notifyUser(`🔎 正在根据别名检索: <code>${escapeHtml(input)}</code>`);
    const movieInfo = await fetchMovieByItemKey(input);
    if (movieInfo) {
      return await showSessionsByMovieId(movieInfo.movieId, defaultCinemaId, null, movieInfo.name);
    }
  }

  // 6. 纯文本输入搜索
  await notifyUser(`🔎 正在搜索电影：<b>${escapeHtml(input)}</b>`);
  const movieInfo = await fetchMovieByItemKey(input);
  if (movieInfo) {
    return await showSessionsByMovieId(movieInfo.movieId, defaultCinemaId, null, movieInfo.name);
  }

  return await notifyUser(`❌ 未能匹配到电影《${escapeHtml(input)}》，若该片尚未定档或放排片，TGV 系统内暂无记录。`);
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
    return await notifyUser(`🟢 <b>系统正常运行中</b>\n当前时间: <code>${escapeHtml(now)}</code>\n监控中场次: <b>${getSubscriptions().length}</b> 个`);
  }

  if (text.startsWith('/list')) {
    if (getSubscriptions().length === 0) {
      return await notifyUser('ℹ️ 当前无监控任务。直接发送电影链接或编号即可添加。');
    }
    let reply = `📋 <b>当前监控任务列表 (${getSubscriptions().length})：</b>\n\n`;
    for (const s of getSubscriptions()) {
      const codeNames = s.targetCodes.map(c => s.targetDetails?.[c]?.name || c).join('\n  • ');
      reply += `🎬 <b>《${escapeHtml(s.movieTitle || '未知电影')}》</b>\n` +
               `⏰ 时间: <code>${escapeHtml(s.showTime || '未记录')}</code> | 影院: ${escapeHtml(s.cinemaId)} (ID: <code>${escapeHtml(s.sessionId)}</code>)\n` +
               `🎯 监控票种:\n  • ${escapeHtml(codeNames)}\n` +
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

  // 统一送入智能解析
  await handleSmartInput(text);
}

// 按钮回调处理
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

  // 展开某天整部电影所有排片
  if (action === 'showall') {
    const [cinemaId, movieId, targetDate] = args;
    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '加载排片中...' });
    return await showSessionsByMovieId(movieId, cinemaId, targetDate);
  }

  // 快速进入单场票种选择
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
    const tickets = cached?.tickets || await fetchTickets(cinemaId, sessionId);

    const promoTickets = tickets.filter(t => 
      t.descriptionAlt?.includes('PROMO') || 
      t.longDescription?.includes('Limit Reached') ||
      ['5785', '5759', '6336'].includes(String(t.ticketTypeCode))
    );

    if (promoTickets.length === 0) {
      return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '未检测到促销票种', show_alert: true });
    }

    let sub = getSubscriptions().find(s => s.sessionId === sessionId && s.cinemaId === cinemaId);
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
      getSubscriptions().push(sub);
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
    saveSubscriptions(getSubscriptions());

    await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '已订阅促销票！' });
    return await notifyUser(`✅ <b>《${escapeHtml(movieName)}》已添加促销票监控！</b>\n时间: <code>${escapeHtml(showTime)}</code>\n包含票种:\n• ` + promoTickets.map(p => escapeHtml(p.description)).join('\n• '));
  }

  if (action === 'sub') {
    const [cinemaId, sessionId, targetCode] = args;
    const cached = sessionCache.get(`${cinemaId}_${sessionId}`);
    const movieName = cached?.movieName || '电影';
    const showTime = cached?.showTime || '';
    const tickets = cached?.tickets || await fetchTickets(cinemaId, sessionId);
    const targetTicket = tickets.find(t => String(t.ticketTypeCode) === targetCode);

    if (!targetTicket) {
      return await callTgApi('answerCallbackQuery', { callback_query_id: cb.id, text: '票种已失效', show_alert: true });
    }

    let sub = getSubscriptions().find(s => s.sessionId === sessionId && s.cinemaId === cinemaId);
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
      getSubscriptions().push(sub);
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
