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

function getSubscriptions() {
  return subscriptions;
}

function setSubscriptions(subs) {
  subscriptions = subs;
}

module.exports = {
  loadSubscriptions,
  saveSubscriptions,
  getSubscriptions,
  setSubscriptions,
  sessionCache
};
