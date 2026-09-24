const axios = require('axios');
const { TG_BOT_TOKEN, TG_CHAT_ID } = require('./config');

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

module.exports = {
  callTgApi,
  notifyUser,
  setupBotCommands
};
