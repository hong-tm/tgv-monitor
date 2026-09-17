// pm2 入口：保持 monitor.js 为唯一入口，避免改动线上进程配置。
// 启动语义与原单文件版一致：仅当作为主模块运行时才 boot；被 require 时无副作用。
const { startTelegramPolling, main } = require('./src/app');
const { runProbeCycle } = require('./src/probe');
const { escapeHtml } = require('./src/util');
const { parseCallback } = require('./src/payload');
const { getSubscriptions, setSubscriptions } = require('./src/store');

if (require.main === module) {
  main();
}

module.exports = {
  escapeHtml,
  parseCallback,
  runProbeCycle,
  startTelegramPolling,
  getSubscriptions,
  setSubscriptions
};
