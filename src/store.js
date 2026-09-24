const fs = require('fs');
const { DATA_FILE } = require('./config');

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

// 有界缓存：只保留最近使用的条目，避免长期运行内存只增不减
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

// 定位或新建 (sessionId, cinemaId) 监控项；只改内存，落盘由调用方决定
function upsertSubscription(cinemaId, sessionId, movieName, showTime) {
  let sub = getSubscriptions().find(s => s.sessionId === sessionId && s.cinemaId === cinemaId);
  if (!sub) {
    sub = {
      sessionId,
      cinemaId,
      movieTitle: movieName,
      showTime: showTime,
      areaCategory: '0000000009',
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
