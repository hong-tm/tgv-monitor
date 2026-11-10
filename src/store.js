const fs = require('fs');
const { DATA_FILE, DEFAULT_AREA_CATEGORY } = require('./config');

function loadSubscriptions() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = [];
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    parsed = null;
  }
  if (!Array.isArray(parsed)) {
    // Quarantine instead of silently returning []: the next save would otherwise
    // overwrite the only copy of the user's subscriptions with an empty list.
    // If the backup itself fails, refuse to start rather than risk the wipe.
    const quarantine = `${DATA_FILE}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(DATA_FILE, quarantine);
      console.error(`[Store] subscriptions.json 无法解析，已备份到 ${quarantine} 并从空列表启动`);
    } catch (e2) {
      console.error(`[Store] subscriptions.json 无法解析且备份失败: ${e2.message}`);
      throw new Error(`subscriptions.json is corrupt and could not be backed up (${e2.message}); refusing to start to avoid wiping it`);
    }
    return [];
  }
  // Older subscriptions stored a single area category ('0000000009') and would
  // keep missing IMAX/beanie tickets forever; the union is the only value this
  // code ever writes now, so normalize legacy entries on load.
  for (const sub of parsed) {
    if (sub && typeof sub === 'object' && sub.areaCategory !== DEFAULT_AREA_CATEGORY) {
      sub.areaCategory = DEFAULT_AREA_CATEGORY;
    }
  }
  return parsed;
}

function saveSubscriptions(data) {
  // Atomic write: a crash mid-write must never truncate the live file
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// Display-only fallbacks the handlers pass when the session cache misses; never store these
const PLACEHOLDER_TITLES = new Set(['电影', '未知电影']);
function isDisplayPlaceholder(name) {
  return !name || PLACEHOLDER_TITLES.has(name) || /^场次 /.test(name);
}

let subscriptions = loadSubscriptions();

const sessionCache = new Map();

// Bounded cache: keeps only recent entries so long-running memory does not grow without limit
const MAX_SESSION_CACHE = 500;
function cacheSession(key, value) {
  if (sessionCache.size >= MAX_SESSION_CACHE && !sessionCache.has(key)) {
    const oldest = sessionCache.keys().next().value;
    if (oldest !== undefined) sessionCache.delete(oldest);
  }
  sessionCache.set(key, value);
}

// Persist the live array without throwing. A failed write (disk full, EACCES)
// keeps the state in memory and raises the flag so the next probe cycle
// retries; an escaping throw would kill the probe interval or drop the
// callback that triggered the save.
let savePending = false;
function persistSubscriptions() {
  try {
    saveSubscriptions(subscriptions);
    savePending = false;
    return true;
  } catch (e) {
    savePending = true;
    console.error(`[Store] 保存订阅状态失败: ${e.message}`);
    return false;
  }
}

function hasPendingSave() {
  return savePending;
}

function getSubscriptions() {
  return subscriptions;
}

function setSubscriptions(subs) {
  subscriptions = subs;
}

// Find-or-create the (sessionId, cinemaId) subscription; memory-only, callers own persistence
function upsertSubscription(cinemaId, sessionId, movieName, showTime) {
  let sub = getSubscriptions().find(s => s.sessionId === sessionId && s.cinemaId === cinemaId);
  if (!sub) {
    sub = {
      sessionId,
      cinemaId,
      movieTitle: movieName,
      showTime: showTime,
      areaCategory: DEFAULT_AREA_CATEGORY,
      targetCodes: [],
      targetDetails: {},
      alerted: false,
      alertedCodes: [],
      failCount: 0
    };
    getSubscriptions().push(sub);
  } else {
    // The handlers pass display placeholders on a sessionCache miss; never clobber metadata.
    if (!isDisplayPlaceholder(movieName)) sub.movieTitle = movieName;
    if (showTime) sub.showTime = showTime;
  }
  return sub;
}

module.exports = {
  loadSubscriptions,
  saveSubscriptions,
  persistSubscriptions,
  hasPendingSave,
  getSubscriptions,
  setSubscriptions,
  sessionCache,
  cacheSession,
  upsertSubscription
};
