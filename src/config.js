const path = require('path');

// === Telegram 配置 ===
const TG_BOT_TOKEN = '***REDACTED-TOKEN***';
const TG_CHAT_ID = '***REDACTED-CHAT-ID***';
const CHECK_INTERVAL_MS = 60 * 1000;
const DATA_FILE = path.join(__dirname, '..', 'subscriptions.json');

const COMMON_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'origin': 'https://www.tgv.com.my',
  'referer': 'https://www.tgv.com.my/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0 Safari/537.36'
};

module.exports = {
  TG_BOT_TOKEN,
  TG_CHAT_ID,
  CHECK_INTERVAL_MS,
  DATA_FILE,
  COMMON_HEADERS
};
