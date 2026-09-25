// pm2 entry: keep monitor.js as the sole entry point so the live process config stays untouched.
// Boot semantics identical to the original single-file version: only runs as the main module; no side effects on require.
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
