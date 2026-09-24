const { notifyUser, callTgApi } = require('./telegram');
const { fetchMovieSessions, fetchTickets, getTodayBusinessDate } = require('./tgv-api');
const { sessionCache, cacheSession, getSubscriptions } = require('./store');
const { escapeHtml } = require('./util');
const { TG_CHAT_ID } = require('./config');

async function showSessionsByMovieId(movieId, cinemaId = 'VIV', targetDate = null, movieNameFallback = null) {
  const date = targetDate || getTodayBusinessDate();
  await notifyUser(`🔍 正在检索电影 UUID <code>${escapeHtml(movieId)}</code> 在 <code>${escapeHtml(date)}</code> 的排片...`);
  const data = await fetchMovieSessions(movieId, cinemaId, date);

  const movieName = data?.movieName || movieNameFallback || '未知电影';
  const sessions = data?.sessions || [];

  if (sessions.length === 0) {
    return await notifyUser(
      `🎬 <b>电影:</b> 《${escapeHtml(movieName)}》\n` +
      `🆔 <b>Movie UUID:</b> <code>${escapeHtml(movieId)}</code>\n` +
      `📅 <b>日期:</b> <code>${escapeHtml(date)}</code> | 影院: ${escapeHtml(cinemaId)}\n\n` +
      `⚠️ 接口暂无此日期的场次排片数据（可能尚未开售或已过映）。`
    );
  }

  const keyboard = [];
  let row = [];
  for (const s of sessions) {
    cacheSession(`${cinemaId}_${s.sessionId}`, { movieName, showTime: s.time });
    row.push({
      text: `🕒 ${s.time} (${s.screen})`,
      callback_data: `pick|${cinemaId}|${s.sessionId}|${s.time}`
    });
    if (row.length === 2) {
      keyboard.push(row);
      row = [];
    }
  }
  if (row.length > 0) keyboard.push(row);

  const msg = `🎬 <b>电影:</b> 《${escapeHtml(movieName)}》\n` +
              `🆔 <b>Movie UUID:</b> <code>${escapeHtml(movieId)}</code>\n` +
              `📅 <b>排片日期:</b> <code>${escapeHtml(date)}</code>\n` +
              `📍 <b>影院:</b> ${escapeHtml(cinemaId)} | 当天共有 <b>${sessions.length}</b> 个场次\n\n` +
              `👇 <b>请点击开场时间直接锁定监控：</b>`;

  return await notifyUser(msg, { inline_keyboard: keyboard });
}

async function showTicketSelection(cinemaId, sessionId, movieName, showTime) {
  await notifyUser(`⏳ 正在读取 <b>《${escapeHtml(movieName)}》</b> (场次 <code>${escapeHtml(sessionId)}</code>) 的可用票种...`);

  try {
    const tickets = await fetchTickets(cinemaId, sessionId);
    if (!tickets || tickets.length === 0) {
      return await notifyUser(`❌ 无法获取场次 <code>${escapeHtml(sessionId)}</code> 的票种数据，可能已停售。`);
    }

    cacheSession(`${cinemaId}_${sessionId}`, { movieName, showTime });

    const inlineKeyboard = [];
    for (const t of tickets) {
      const code = String(t.ticketTypeCode);
      const name = t.description;
      const price = t.priceInCents / 100;
      const quota = t.quantityAvailablePerOrder;
      const isPromo = t.descriptionAlt?.includes('PROMO') || t.longDescription?.includes('Limit Reached');

      inlineKeyboard.push([{
        text: `${isPromo ? '🔥' : '🎟️'} ${name} (RM${price}) [剩余:${quota}]`,
        callback_data: `sub|${cinemaId}|${sessionId}|${code}`
      }]);
    }

    inlineKeyboard.unshift([{
      text: '⚡ 一键监控该场次全部促销票 (Promo Only)',
      callback_data: `suball|${cinemaId}|${sessionId}`
    }]);

    const msg = `🎬 <b>《${escapeHtml(movieName)}》</b> ${showTime ? `(<code>${escapeHtml(showTime)}</code>)` : ''}\n` +
                `📍 影院: ${escapeHtml(cinemaId)} | 场次 ID: <code>${escapeHtml(sessionId)}</code>\n` +
                `───────────────────\n` +
                `👇 <b>点击锁定要监控的票种：</b>`;

    return await notifyUser(msg, { inline_keyboard: inlineKeyboard });
  } catch (e) {
    return await notifyUser(`❌ 探测票种失败: ${escapeHtml(e.message)}`);
  }
}

async function sendRealtimeDashboard(messageIdToEdit = null) {
  if (getSubscriptions().length === 0) {
    const emptyMsg = 'ℹ️ 当前无监控任务。';
    if (messageIdToEdit) {
      return await callTgApi('editMessageText', { chat_id: TG_CHAT_ID, message_id: messageIdToEdit, text: emptyMsg });
    }
    return await notifyUser(emptyMsg);
  }

  const now = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' });
  let text = `📊 <b>TGV 实时票况看板</b>\n更新时间: <code>${escapeHtml(now)}</code>\n───────────────────\n`;

  for (const s of getSubscriptions()) {
    text += `🎬 <b>《${escapeHtml(s.movieTitle || '未知电影')}》</b> (${escapeHtml(s.showTime || '')})\n` +
            `📍 影院: ${escapeHtml(s.cinemaId)} | 场次: <code>${escapeHtml(s.sessionId)}</code>\n`;
    try {
      const tickets = await fetchTickets(s.cinemaId, s.sessionId, s.areaCategory);
      for (const code of s.targetCodes) {
        const t = tickets.find(item => String(item.ticketTypeCode) === code);
        if (!t) {
          text += `  • <code>${escapeHtml(code)}</code>: <i>未在售/已下架</i>\n`;
          continue;
        }
        const quota = t.quantityAvailablePerOrder;
        const limitReached = t.longDescription && t.longDescription.includes("Today's Promotion Limit Reached");
        const statusIcon = (quota > 0 && !limitReached) ? '🟢 <b>有票可抢</b>' : '🔴 额度已尽';
        text += `  • <b>${escapeHtml(t.description)}</b> (RM${t.priceInCents / 100}): ${statusIcon} [剩余: ${quota}]\n`;
      }
    } catch (e) {
      text += `  • <i>请求失败: ${escapeHtml(e.message)}</i>\n`;
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

async function sendHelp() {
  return await notifyUser(
    `🎬 <b>TGV 极速抢票监控系统</b>\n\n` +
    `快捷指令：\n` +
    `🔹 <code>/uuid &lt;链接或UUID&gt;</code> - 查 UUID 并列出全天排片\n` +
    `🔹 <code>/check</code> - 实时票况看板（支持原地刷新）\n` +
    `🔹 <code>/list</code> - 查看监控列表\n` +
    `🔹 <code>/del</code> - 选择删除已监控场次\n` +
    `🔹 <code>/status</code> - 运行健康状况\n\n` +
    `直接发送任意选座直链、电影链接或电影名均可智能处理。`
  );
}

async function sendSubscriptionList() {
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

module.exports = {
  showSessionsByMovieId,
  showTicketSelection,
  sendRealtimeDashboard,
  sendHelp,
  sendSubscriptionList
};
