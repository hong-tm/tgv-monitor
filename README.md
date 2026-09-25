# tgv-monitor

A Telegram bot that watches TGV Cinemas (Malaysia) promo-ticket availability and pings you the moment quota opens up.

## Features

- Paste a seat-selection link, movie link, 36-char UUID, session number, or movie alias — it classifies the input and walks you into a subscription
- One-tap subscribe to every promo ticket type of a session (`suball`), or pick types individually
- Availability rule: `quantityAvailablePerOrder > 0` and the daily promo limit not reached (`Today's Promotion Limit Reached`)
- `/check` live ticket dashboard (refreshes in place via inline button), `/list`, `/del`, `/status`
- Auto-removes offline sessions after 15 consecutive probe failures; one alert per session until it resets

## Architecture

Node.js (CommonJS) + axios + the raw Telegram Bot API over long polling; no other runtime dependency. Single pm2 fork instance.

| Module | Role |
|---|---|
| `monitor.js` | pm2 entry shim (`require.main` guard; no side effects when required) |
| `src/config.js` | credential resolution, polling interval, TGV domain constants |
| `src/input-classifier.js` | pure input classification into six intents (no I/O, unit-tested standalone) |
| `src/handlers.js` | command and callback routing |
| `src/views.js` | all user-facing copy and inline keyboards |
| `src/store.js` | `subscriptions` state and the bounded `sessionCache` |
| `src/tgv-api.js` | TGV API wrappers (itemkey → sessions → ticket types) |
| `src/telegram.js` | Telegram transport (https agent pinned to IPv4) |
| `src/probe.js` | polling probe and alerting |
| `src/app.js` | startup flow and the getUpdates long-poll loop |

## Credentials

Credentials never enter the repository. They resolve in this order (see `src/config.js`):

1. environment variables `TG_BOT_TOKEN` / `TG_CHAT_ID`
2. an out-of-repo credential file (path via `$TGV_ENV_FILE`)
3. a project-local `.env` (gitignored; template in `.env.example`)

Missing credentials fail at startup via `assertCredentials()` instead of surfacing a Telegram 404 later.

## Usage

```bash
npm install
npm test                                 # 48 offline tests (axios fully stubbed)
npm start                                # foreground
pm2 startOrRestart ecosystem.config.js   # pm2 deployment (example config; adjust paths)
```

## Notes

- Business timezone is Asia/Kuala_Lumpur (TGV business dates follow Kuala Lumpur)
- `src/telegram.js` pins the https agent to IPv4: api.telegram.org publishes AAAA records, and on hosts without an IPv6 route the default resolution wastes a guaranteed `ENETUNREACH` attempt
- `subscriptions.json` is runtime state and stays untracked (gitignored)

## 中文速览

TGV 促销票监控机器人：每 60 秒轮询 TGV boxoffice 接口，监控中的促销票种一旦出现可抢额度，立刻 Telegram 提醒。直接粘贴选座链接 / 电影链接 / UUID / 场次号 / 别名即可订阅；`/check` 实时票况看板，`/list`、`/del`、`/status` 管理监控。

凭据不进仓库，解析顺序：环境变量 → 仓库外凭据文件（`$TGV_ENV_FILE`）→ 项目内 `.env`（模板见 `.env.example`，已被 gitignore）。缺凭据启动即报错。

`npm test` 跑 48 个离线测试；`pm2 startOrRestart ecosystem.config.js` 部署。业务时区为吉隆坡；`subscriptions.json` 是运行时状态，不入库。

License: MIT.
