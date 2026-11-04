const { notifyUser } = require('./telegram');
const { fetchTickets } = require('./tgv-api');
const { getSubscriptions, saveSubscriptions } = require('./store');
const { escapeHtml } = require('./util');

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
      if (!sub) continue;

      try {
        const tickets = await fetchTickets(sub.cinemaId, sub.sessionId, sub.areaCategory);
        // /del can replace the array while the fetch is in flight; skip entries that are gone
        if (!getSubscriptions().includes(sub)) continue;
        sub.failCount = 0;

        if (!tickets || tickets.length === 0) continue;

        let availableCodes = [];
        let matchedDescriptions = [];

        for (const t of tickets) {
          const code = String(t.ticketTypeCode);
          if (sub.targetCodes.includes(code)) {
            const quota = t.quantityAvailablePerOrder;
            const limitReached = t.longDescription && t.longDescription.includes("Today's Promotion Limit Reached");

            if (quota > 0 && !limitReached) {
              availableCodes.push(code);
              matchedDescriptions.push(`🎫 <b>${escapeHtml(t.description)}</b> (剩余: ${quota} 张 | RM${t.priceInCents / 100})`);
            }
          }
        }

        // Per-code alert state: a boolean flag shared by all codes both re-announced
        // the old code and suppressed the new one (Greptile P1). alertedCodes tracks
        // which codes have had their delivery; sub.alerted stays as the /list badge.
        if (!Array.isArray(sub.alertedCodes)) sub.alertedCodes = [];
        const fresh = availableCodes.filter(c => !sub.alertedCodes.includes(c));

        if (fresh.length > 0) {
            const alertMsg = `🎉 <b>TGV 放票通知！</b>\n\n` +
                             `电影: <b>《${escapeHtml(sub.movieTitle || '电影')}》</b>\n` +
                             `时间: <code>${escapeHtml(sub.showTime || '')}</code>\n` +
                             `影院: <b>${escapeHtml(sub.cinemaId)}</b> | 场次: <code>${escapeHtml(sub.sessionId)}</code>\n\n` +
                             matchedDescriptions.join('\n') + `\n\n` +
                             `⏰ 触发时间: <code>${escapeHtml(now)}</code>\n` +
                             `👉 立即前往 TGV 结账！`;
            const sent = await notifyUser(alertMsg, {
              inline_keyboard: [[{ text: '🔍 查看当前票况', callback_data: 'refresh_dashboard' }]]
            });
            // Mark delivered only on success; a failed send (502/429/timeout) retries next cycle
            if (sent && sent.ok) {
              sub.alertedCodes.push(...fresh);
              sub.alerted = true;
              dirty = true;
            }
        } else if (availableCodes.length === 0) {
          // Nothing on sale any more: re-arm both the per-code state and the /list badge.
          // (availableCodes non-empty but all delivered keeps the delivered state.)
          if (sub.alerted) {
            sub.alerted = false;
            dirty = true;
          }
          if (sub.alertedCodes.length > 0) {
            sub.alertedCodes = [];
            dirty = true;
          }
        }

      } catch (err) {
        sub.failCount = (sub.failCount || 0) + 1;
        console.error(`[Probe] 探测失败 (${sub.cinemaId}/${sub.sessionId}) failCount=${sub.failCount}: ${err.message}`);
        if (sub.failCount >= 15) {
          const removed = await notifyUser(`⚠️ <b>场次自动失效提醒</b>\n电影《${escapeHtml(sub.movieTitle || sub.sessionId)}》场次已下线，已自动移出监控。`);
          // Remove only once the notice landed; a failed send retries next cycle.
          // Recompute the index after the await: /del can shift the array mid-notice.
          if (removed && removed.ok) {
            const idx = getSubscriptions().indexOf(sub);
            if (idx !== -1) {
              getSubscriptions().splice(idx, 1);
              dirty = true;
            }
          }
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
