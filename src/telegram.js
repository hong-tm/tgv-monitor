const https = require('https');
const axios = require('axios');
const { TG_BOT_TOKEN, TG_CHAT_ID } = require('./config');

// 本机无 IPv6 路由，钉死 IPv4，省掉对必然 ENETUNREACH 的 AAAA 尝试
const TG_HTTPS_AGENT = new https.Agent({ family: 4, keepAlive: true });
const TG_TIMEOUT_MS = 35000;

async function callTgApi(method, data = {}, timeoutMs = TG_TIMEOUT_MS) {
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`;
  try {
    const res = await axios.post(url, data, { timeout: timeoutMs, httpsAgent: TG_HTTPS_AGENT });
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
