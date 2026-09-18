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
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000
    }
  ]
};
