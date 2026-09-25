const path = require('path');
const fs = require('fs');

// Credentials are not hardcoded. Resolution order: env vars > out-of-repo credential file > project .env (gitignored).
// The project .env exists to mirror the .env.example template for local development.
// fileCreds below merges as { ...LOCAL_ENV_FILE, ...CRED_FILE }: the out-of-repo file wins,
// so a stale local .env can never shadow production credentials.
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

const DEFAULT_AREA_CATEGORY = '0000000009';
const PROMO_TICKET_CODES = ['5785', '5759', '6336'];

// Fail fast at startup on missing credentials, instead of surfacing a Telegram 404 later
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
  DEFAULT_AREA_CATEGORY,
  PROMO_TICKET_CODES,
  assertCredentials
};
