# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-06
**Git:** not a git repository

## OVERVIEW
Single-file Node.js (CommonJS) Telegram bot that monitors ticket availability for TGV,
a Malaysian cinema chain (tgv.com.my). Polls the TGV boxoffice API every 60s and
alerts the owner via Telegram when monitored promo tickets gain sellable quota.
Stack: axios + raw Telegram Bot API over long-polling.

## STRUCTURE
```
tgv-monitor/
├── monitor.js            # the entire application (731 lines)
├── package.json          # commonjs; deps: axios, node-telegram-bot-api
├── package-lock.json
├── subscriptions.json    # runtime state: monitored sessions (mutated live by bot)
├── node_modules/
└── .omo/                 # agent session state — NOT project code, ignore
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Any new feature | monitor.js | single file, no modules |
| Telegram commands (/uuid /check /list /del /status) | `handleMessage` + `handleSmartInput` | monitor.js:360-432, 256 |
| Inline button actions | `handleCallbackQuery` | monitor.js:489; prefix scheme `pick_ sub_ suball_ del_ quicksub_ showall_ refresh_dashboard` |
| TGV API calls | `fetchMovieByItemKey` / `fetchMovieSessions` / `fetchTickets` | monitor.js:85-170; MOVIE_BY_ITEMKEY → SESSIONS → TICKETS chain |
| Polling/alert logic | `runProbeCycle` | monitor.js:656; dedup via `alerted` flag, auto-remove at 15 fails |
| Dashboard board | `sendRealtimeDashboard` | monitor.js:435 |
| Persistence | `loadSubscriptions` / `saveSubscriptions` | monitor.js:49-64; synchronous fs |
| Bot command registration | `setupBotCommands` | monitor.js:36 |
| Telegram transport | `callTgApi` / `notifyUser` | monitor.js:15-33; raw API, HTML parse_mode |

## CODE MAP
Full-file read (no LSP/codegraph available). All symbols live in monitor.js.

| Symbol | Role |
|--------|------|
| `TG_BOT_TOKEN` `TG_CHAT_ID` (7-8) | hardcoded credentials — treat as secret, never log/echo |
| `CHECK_INTERVAL_MS` (9) | probe cadence, 60s |
| `sessionCache` (12) | Map `cinema_session` → {movieName, showTime, tickets} for callback handling |
| `callTgApi` (15) | axios POST to api.telegram.org, swallows errors → null |
| `notifyUser` (26) | sendMessage with HTML + optional reply_markup |
| `setupBotCommands` (36) | setMyCommands for the 5 slash commands |
| `load/saveSubscriptions` (49-64) | JSON file state; save = full rewrite, sync |
| `generateUserSessionId` (68) | crypto.randomBytes hex, per tickets request |
| `getTodayBusinessDate` (72) | Asia/Kuala_Lumpur date, en-CA → YYYY-MM-DD |
| `COMMON_HEADERS` (76) | spoofed browser headers for api.tgv.com.my |
| `fetchMovieByItemKey` (85) | itemkey → movie recid; tries 2 endpoints, falls back to now-showing list |
| `fetchMovieSessions` (115) | movieid+date+cinema → session list (time/screen/sessionId) |
| `fetchTickets` (158) | session → ticket types (quota, priceInCents, promo flags) |
| `showSessionsByMovieId` (173) | session picker keyboard |
| `showTicketSelection` (214) | ticket-type picker keyboard + `/suball` promo shortcut |
| `handleSmartInput` (256) | text router: seat link, movie link, UUID, numeric session, alias, plain search |
| `handleMessage` (360) | chat-id-gated command dispatch → smart input fallback |
| `sendRealtimeDashboard` (435) | per-subscription ticket status board, editable + refresh button |
| `handleCallbackQuery` (489) | all inline button routing |
| `startTelegramPolling` (631) | infinite getUpdates long-poll loop; fire-and-forget |
| `runProbeCycle` (656) | per-sub ticket probe; alerts on quota>0 & !LimitReached |
| `main` (721) | startup: commands + hello + polling + probe interval |

## CONVENTIONS
- Chinese comments and Chinese emoji-heavy Telegram copy — keep this style in new code.
- Raw Telegram Bot API through `callTgApi`/axios. The `node-telegram-bot-api` dependency is **dead** — do not start using it.
- Hardcoded domain constants: cinema `VIV`, `areaCategory '0000000009'`, promo ticket codes `['5785','5759','6336']`.
- Persistence: mutate module-global `subscriptions`, call `saveSubscriptions` on change. No other state files.
- Async flow: `main()` not awaited; both loops launched fire-and-forget. Never await `startTelegramPolling()` (infinite loop).
- Error style: TGV fetch errors → return null / empty and let callers degrade gracefully; `failCount`-based auto-removal (>=15).

## ANTI-PATTERNS (THIS PROJECT)
- **Do NOT reproduce the values of `TG_BOT_TOKEN`/`TG_CHAT_ID`** (monitor.js:7-8) in docs, logs, or commits. Never print them.
- callback_data parsers use `split('_')` — any underscore inside a payload (e.g. movie alias) corrupts routing. Keep encoded payloads underscore-free or escape them.
- No tests exist; `npm test` is a stub that exits 1. If adding tests, update the script first. Don't "fix" the stub silently.
- Don't add new persistence files — extend the existing load/save pair.
- Don't change empty `catch {}` blocks into loggers without intent: they implement silent endpoint failover (try next endpoint / mark probe failed).

## COMMANDS
```bash
node monitor.js    # run the bot (long-running; Ctrl+C to stop)
npm install        # restore deps (axios, node-telegram-bot-api)
npm test           # STUB — always exits 1, no test suite
```
No build/lint/format tooling exists.

## NOTES
- TGV business day is Asia/Kuala_Lumpur; date math uses `en-CA` locale strings (YYYY-MM-DD).
- `subscriptions.json` is live runtime state: entries carry `alerted`/`failCount` — do not hand-edit while bot runs (load happens once at startup).
- Movie titles in callback payloads are `encodeURIComponent`-ed; `showTime` is `HH:MM` derived from `showtimemy` (substring 11-16 of the ISO string).
- `package.json` declares `"main": "index.js"` but no index.js exists — entry is `node monitor.js`.
- Alert detection quirk: `quantityAvailablePerOrder > 0` AND description does NOT contain "Today's Promotion Limit Reached".