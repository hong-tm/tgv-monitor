const { callTgApi, setupBotCommands, notifyUser } = require('./telegram');
const { handleMessage, handleCallbackQuery } = require('./handlers');
const { runProbeCycle } = require('./probe');
const { CHECK_INTERVAL_MS } = require('./config');

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

      // callTgApi 自己吞掉异常返回 null，这里必须补延迟，否则失败时会零延迟空转打爆 Telegram
      if (!res || res.ok !== true) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      await new Promise(r => setTimeout(r, 3000));
    }
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

module.exports = {
  lastUpdateId,
  startTelegramPolling,
  main
};
