const { callTgApi, setupBotCommands, notifyUser } = require('./telegram');
const { handleMessage, handleCallbackQuery } = require('./handlers');
const { runProbeCycle } = require('./probe');
const { CHECK_INTERVAL_MS, assertCredentials } = require('./config');

let lastUpdateId = 0;

// offset:-1 是 Telegram 的「丢弃积压」语义：返回最后一条 update 并清空队列，
// 借此避免重启后重放旧指令，无需新增持久化文件（本项目约定不新增状态文件）。
async function skipBacklog() {
  const res = await callTgApi('getUpdates', { offset: -1, timeout: 0 });
  if (res && res.ok && Array.isArray(res.result) && res.result.length > 0) {
    lastUpdateId = res.result[res.result.length - 1].update_id;
  }
}

async function startTelegramPolling() {
  await skipBacklog();
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
  assertCredentials();
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
