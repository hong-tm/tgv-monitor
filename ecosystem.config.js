// pm2 配置：app 名与脚本路径必须与线上现有进程一致（id 0 / tgv-monitor），
// 否则 startOrRestart 会新建一个 app 而不是复用，造成双实例抢 getUpdates（409）。
// 凭据不在此文件内：src/config.js 会从环境变量或 /root/.config/tgv-monitor/env 读取。
module.exports = {
  apps: [
    {
      name: 'tgv-monitor',
      script: '/root/tgv-monitor/monitor.js',
      cwd: '/root/tgv-monitor',
      exec_mode: 'fork',
      instances: 1,
      // 本机无 IPv6 默认路由，但 api.telegram.org 有 AAAA 记录：
      // Node 默认 verbatim 会先连 IPv6 → ENETUNREACH / ETIMEDOUT。强制 IPv4 优先。
      // 用 NODE_OPTIONS（而非 node_args）：pm2 fork 模式下可直接从 /proc/<pid>/environ 验证已生效。
      env: { NODE_OPTIONS: '--dns-result-order=ipv4first' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000
    }
  ]
};
