const path = require('path');
const fs = require('fs');

// === Telegram 配置 ===
// 凭据不再硬编码，按优先级读取：环境变量 > 仓库外凭据文件 > 项目内 .env（已被 .gitignore 忽略）。
// 支持项目内 .env 是为了与仓库中的 .env.example 样板保持一致，便于本地开发。
// 下方 fileCreds 按 { ...LOCAL_ENV_FILE, ...CRED_FILE } 合并：仓库外凭据文件优先，
// 项目内一份陈旧 .env 顶不掉生产凭据。
const CRED_FILE = process.env.TGV_ENV_FILE || '/root/.config/tgv-monitor/env';
const LOCAL_ENV_FILE = path.join(__dirname, '..', '.env');

function parseEnvText(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function readEnvFile(file) {
  try {
    return parseEnvText(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return {};
  }
}

const fileCreds = { ...readEnvFile(LOCAL_ENV_FILE), ...readEnvFile(CRED_FILE) };

const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || fileCreds.TG_BOT_TOKEN || '';
const TG_CHAT_ID = process.env.TG_CHAT_ID || fileCreds.TG_CHAT_ID || '';

const CHECK_INTERVAL_MS = 60 * 1000;
const DATA_FILE = path.join(__dirname, '..', 'subscriptions.json');

const COMMON_HEADERS = {
  'accept': 'application/json, text/plain, */*',
  'content-type': 'application/json',
  'origin': 'https://www.tgv.com.my',
  'referer': 'https://www.tgv.com.my/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0 Safari/537.36'
};

// 启动期校验：缺凭据时立即失败，而不是等到第一次调用 Telegram 才报 404
function assertCredentials() {
  const missing = [];
  if (!TG_BOT_TOKEN) missing.push('TG_BOT_TOKEN');
  if (!TG_CHAT_ID) missing.push('TG_CHAT_ID');
  if (missing.length > 0) {
    throw new Error(`缺少凭据 ${missing.join(', ')}：请设置环境变量，或写入 ${CRED_FILE}`);
  }
}

module.exports = {
  TG_BOT_TOKEN,
  TG_CHAT_ID,
  CHECK_INTERVAL_MS,
  DATA_FILE,
  COMMON_HEADERS,
  assertCredentials
};
