// pm2 config: the app name and script path must match the existing live process (tgv-monitor),
// otherwise startOrRestart spawns a second app instead of reusing it, and two pollers fight over getUpdates (409).
// Credentials do not live in this file: src/config.js reads them from env vars or /root/.config/tgv-monitor/env.
module.exports = {
  apps: [
    {
      name: 'tgv-monitor',
      script: '/root/tgv-monitor/monitor.js',
      cwd: '/root/tgv-monitor',
      exec_mode: 'fork',
      instances: 1,
      // This host has no IPv6 default route, but api.telegram.org has AAAA records:
      // Node's default (verbatim) tries IPv6 first -> ENETUNREACH / ETIMEDOUT. Force IPv4 first.
      // NODE_OPTIONS (not node_args): under pm2 fork mode this is verifiable via /proc/<pid>/environ.
      env: { NODE_OPTIONS: '--dns-result-order=ipv4first' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000
    }
  ]
};
