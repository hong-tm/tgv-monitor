# tgv-monitor

A Telegram bot that watches TGV Cinemas (Malaysia) promo-ticket availability and pings you the moment quota opens up.

TGV 促销票监控机器人：每 60 秒轮询 TGV boxoffice 接口，一旦监控中的促销票种出现可抢额度，立刻通过 Telegram 提醒你去抢票。

## 功能

- 直接粘贴选座链接 / 电影链接 / 36 位 UUID / 场次号 / 电影别名，自动识别并进入订阅流程
- 促销票种一键全订（`suball`），也可逐票种挑选
- 有票判定：`quantityAvailablePerOrder > 0` 且未触发当日促销上限（`Today's Promotion Limit Reached`）
- `/check` 实时票况看板（消息内按钮原地刷新）、`/list` 监控列表、`/del` 删除场次、`/status` 健康状态
- 场次下线自动移出监控（连续 15 次探测失败），已提醒过的场次静默去重

## 架构

Node.js（CommonJS）+ axios + 原生 Telegram Bot API 长轮询，无其他运行时依赖。pm2 单实例部署。

| 模块 | 职责 |
|---|---|
| `monitor.js` | pm2 入口 shim（`require.main` 守卫，被 require 时无副作用） |
| `src/config.js` | 凭据解析、轮询间隔、TGV 域名常量 |
| `src/input-classifier.js` | 纯函数输入分类（六种意图，无 I/O，独立单测） |
| `src/handlers.js` | 命令与回调路由 |
| `src/views.js` | 全部用户文案与内联键盘 |
| `src/store.js` | `subscriptions` 状态与有界 `sessionCache` |
| `src/tgv-api.js` | TGV 接口封装（itemkey → 排片 → 票种） |
| `src/telegram.js` | Telegram 传输（https agent 钉 IPv4） |
| `src/probe.js` | 轮询探测与告警 |
| `src/app.js` | 启动流程与 getUpdates 长轮询循环 |

## 凭据

凭据不进仓库，按以下优先级解析（见 `src/config.js`）：

1. 环境变量 `TG_BOT_TOKEN` / `TG_CHAT_ID`
2. 仓库外凭据文件（路径由 `$TGV_ENV_FILE` 指定）
3. 项目内 `.env`（已被 `.gitignore` 忽略，模板见 `.env.example`）

缺凭据时启动即报错退出，不会等到第一次调用 Telegram 才 404。

## 运行

```bash
npm install
npm test                              # 48 个离线测试（axios 全程打桩，不联网）
npm start                             # 前台运行
pm2 startOrRestart ecosystem.config.js  # pm2 部署（示例配置，路径按需修改）
```

## 备注

- 业务时区为 Asia/Kuala_Lumpur（TGV 的 business date 按吉隆坡计算）
- `src/telegram.js` 把 https agent 固定在 IPv4：api.telegram.org 有 AAAA 记录，无 IPv6 路由的主机用默认解析会白白撞 `ENETUNREACH`
- `subscriptions.json` 是运行时状态文件，不入库（`.gitignore` 已排除）
