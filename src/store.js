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
    const quarantine = `${DATA_FILE}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(DATA_FILE, quarantine);
      console.error(`[Store] subscriptions.json 无法解析，已备份到 ${quarantine} 并从空列表启动`);
    } catch (e2) {
      console.error(`[Store] subscriptions.json 无法解析且备份失败: ${e2.message}`);
    }
    return [];
  }
  return parsed;
}

function saveSubscriptions(data) {
  // Atomic write: a crash mid-write must never truncate the live file
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
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
      failCount: 0
    };
    getSubscriptions().push(sub);
  } else {
    sub.movieTitle = movieName;
    sub.showTime = showTime;
  }
  return sub;
}

module.exports = {
  loadSubscriptions,
  saveSubscriptions,
  getSubscriptions,
  setSubscriptions,
  sessionCache,
  cacheSession,
  upsertSubscription
};
