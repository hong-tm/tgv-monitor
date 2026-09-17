const { notifyUser } = require('./telegram');
const { fetchTickets } = require('./tgv-api');
const { getSubscriptions, saveSubscriptions } = require('./store');
const { escapeHtml } = require('./util');

// 探测轮询
let probeRunning = false;
async function runProbeCycle() {
  if (probeRunning) {
    console.log('[Probe] 上一轮探测尚未结束，跳过本次触发');
    return;
  }
  probeRunning = true;
  try {
    const now = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur' });
    let dirty = false;

    for (let i = getSubscriptions().length - 1; i >= 0; i--) {
      const sub = getSubscriptions()[i];

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
              matchedDescriptions.push(`🎫 <b>${escapeHtml(t.description)}</b> (剩余: ${quota} 张 | RM${t.priceInCents / 100})`);
            }
          }
        }

        if (hasAvailableQuota) {
          if (!sub.alerted) {
            sub.alerted = true;
            dirty = true;
            const alertMsg = `🎉 <b>TGV 放票通知！</b>\n\n` +
                             `电影: <b>《${escapeHtml(sub.movieTitle || '电影')}》</b>\n` +
                             `时间: <code>${escapeHtml(sub.showTime || '')}</code>\n` +
                             `影院: <b>${escapeHtml(sub.cinemaId)}</b> | 场次: <code>${escapeHtml(sub.sessionId)}</code>\n\n` +
                             matchedDescriptions.join('\n') + `\n\n` +
                             `⏰ 触发时间: <code>${escapeHtml(now)}</code>\n` +
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
        console.error(`[Probe] 探测失败 (${sub.cinemaId}/${sub.sessionId}) failCount=${sub.failCount}: ${err.message}`);
        if (sub.failCount >= 15) {
          await notifyUser(`⚠️ <b>场次自动失效提醒</b>\n电影《${escapeHtml(sub.movieTitle || sub.sessionId)}》场次已下线，已自动移出监控。`);
          getSubscriptions().splice(i, 1);
          dirty = true;
        }
      }
    }

    if (dirty) {
      saveSubscriptions(getSubscriptions());
    }
  } finally {
    probeRunning = false;
  }
}

module.exports = {
  probeRunning,
  runProbeCycle
};
