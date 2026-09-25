const fs = require('fs');
const { DATA_FILE, DEFAULT_AREA_CATEGORY } = require('./config');

function loadSubscriptions() {
  if (!fs.existsSync(DATA_FILE)) {
    const defaultData = [];
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function saveSubscriptions(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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
