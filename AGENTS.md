# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-06
**Git:** repo root is `/root` (no remote); history: `c2b8de0` baseline → `1bd4b07` step-1 fixes → `24b5826` module split → step-3 hardening
**Stale:** line numbers in the CODE MAP are approximate; the layout below reflects the step-2 module split.

## OVERVIEW
Node.js (CommonJS) Telegram bot that monitors ticket availability for TGV,
a Malaysian cinema chain (tgv.com.my). Polls the TGV boxoffice API every 60s and
alerts the owner via Telegram when monitored promo tickets gain sellable quota.
Stack: axios + raw Telegram Bot API over long-polling.
Was a single 826-line file; split into `src/` modules in step 2 (`monitor.js` is now a 20-line entry shim).

## CREDENTIALS
Bot token and chat id are NOT in the repo. Loaded at startup from (in order):
1. env `TG_BOT_TOKEN` / `TG_CHAT_ID`
2. a dotenv-style file at `$TGV_ENV_FILE` (default `/root/.config/tgv-monitor/env`, mode 600, outside the git repo)

`assertCredentials()` runs at the top of `main()` so a missing credential fails loudly at startup
instead of surfacing later as a Telegram 404. To rotate: edit that file, then `pm2 startOrRestart ecosystem.config.js`.

## STRUCTURE
```
tgv-monitor/
├── monitor.js            # pm2 entry shim only (20 lines): require.main guard + 6 re-exports
├── src/
│   ├── config.js         # TG_BOT_TOKEN, TG_CHAT_ID, CHECK_INTERVAL_MS, DATA_FILE, COMMON_HEADERS
│   ├── util.js           # escapeHtml
│   ├── payload.js        # safeDecode, parseCallback
│   ├── telegram.js       # callTgApi, notifyUser, setupBotCommands
│   ├── tgv-api.js        # generateUserSessionId, getTodayBusinessDate, fetchMovieByItemKey/Sessions/Tickets
│   ├── store.js          # subscriptions (get/set accessors) + sessionCache; load/save
│   ├── views.js          # showSessionsByMovieId, showTicketSelection, sendRealtimeDashboard
│   ├── handlers.js       # handleSmartInput, handleMessage, handleCallbackQuery
│   ├── probe.js          # probeRunning, runProbeCycle
│   └── app.js            # lastUpdateId, startTelegramPolling, main
├── package.json          # commonjs; deps: axios, node-telegram-bot-api
├── package-lock.json
├── subscriptions.json    # runtime state: monitored sessions (mutated live by bot)
├── node_modules/
└── .omo/                 # agent session state — NOT project code, ignore
```
Dependency direction (acyclic): `config`/`util`/`payload` → none; `telegram`/`tgv-api`/`store` → config;
`views` → telegram, tgv-api, store, util, config; `handlers` → telegram, tgv-api, store, payload, views, util, config;
`probe` → telegram, tgv-api, store, util; `app` → telegram, handlers, probe, config;
`monitor.js` (shim) → app, probe, util, payload, store.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Any new feature | `src/` modules | pick the module owning the concern; keep the shim thin |
| Telegram commands (/uuid /check /list /del /status) | `handleMessage` + `handleSmartInput` | src/handlers.js |
| Inline button actions | `handleCallbackQuery` | src/handlers.js; prefix scheme `pick_ sub_ suball_ del_ quicksub_ showall_ refresh_dashboard` |
| TGV API calls | `fetchMovieByItemKey` / `fetchMovieSessions` / `fetchTickets` | src/tgv-api.js; MOVIE_BY_ITEMKEY → SESSIONS → TICKETS chain |
| Polling/alert logic | `runProbeCycle` | src/probe.js; dedup via `alerted` flag, auto-remove at 15 fails |
| Dashboard board | `sendRealtimeDashboard` | src/views.js |
| Persistence | `loadSubscriptions` / `saveSubscriptions` | src/store.js; synchronous fs |
| Bot command registration | `setupBotCommands` | src/telegram.js |
| Telegram transport | `callTgApi` / `notifyUser` | src/telegram.js; raw API, HTML parse_mode |

## CODE MAP
Split across `src/` (step 2); `monitor.js` is a thin pm2 entry shim that re-exports 6 symbols.

| Symbol | Role | Module |
|--------|------|--------|
| `TG_BOT_TOKEN` `TG_CHAT_ID` | loaded from env or the out-of-repo credential file (see CREDENTIALS) — never log/echo | src/config.js |
| `assertCredentials` | startup guard: throws if credentials are missing | src/config.js |
| `CHECK_INTERVAL_MS` | probe cadence, 60s | src/config.js |
| `COMMON_HEADERS` | spoofed browser headers for api.tgv.com.my | src/config.js |
| `escapeHtml` | HTML-escape dynamic content before Telegram HTML messages | src/util.js |
| `safeDecode` / `parseCallback` | callback_data decode + `|`/legacy-underscore parser | src/payload.js |
| `callTgApi` | axios POST to api.telegram.org, swallows errors → null | src/telegram.js |
| `notifyUser` | sendMessage with HTML + optional reply_markup | src/telegram.js |
| `setupBotCommands` | setMyCommands for the 5 slash commands | src/telegram.js |
| `sessionCache` | Map `cinema_session` → {movieName, showTime} for callback handling (no tickets) | src/store.js |
| `cacheSession` | bounded writer for `sessionCache` (FIFO cap 500) — prefer over `sessionCache.set` | src/store.js |
| `load/saveSubscriptions` | JSON file state; save = full rewrite, sync | src/store.js |
| `getSubscriptions` / `setSubscriptions` | the ONLY accessors to the live `subscriptions` array | src/store.js |
| `generateUserSessionId` | crypto.randomBytes hex, per tickets request | src/tgv-api.js |
| `getTodayBusinessDate` | Asia/Kuala_Lumpur date, en-CA → YYYY-MM-DD | src/tgv-api.js |
| `fetchMovieByItemKey` | itemkey → movie recid; tries 2 endpoints, falls back to now-showing list | src/tgv-api.js |
| `fetchMovieSessions` | movieid+date+cinema → session list (time/screen/sessionId) | src/tgv-api.js |
| `fetchTickets` | session → ticket types (quota, priceInCents, promo flags) | src/tgv-api.js |
| `showSessionsByMovieId` | session picker keyboard | src/views.js |
| `showTicketSelection` | ticket-type picker keyboard + `/suball` promo shortcut | src/views.js |
| `sendRealtimeDashboard` | per-subscription ticket status board, editable + refresh button | src/views.js |
| `handleSmartInput` | text router: seat link, movie link, UUID, numeric session, alias, plain search | src/handlers.js |
| `handleMessage` | chat-id-gated command dispatch → smart input fallback | src/handlers.js |
| `handleCallbackQuery` | all inline button routing | src/handlers.js |
| `runProbeCycle` | per-sub ticket probe; alerts on quota>0 & !LimitReached | src/probe.js |
| `startTelegramPolling` | infinite getUpdates long-poll loop; fire-and-forget | src/app.js |
| `main` | startup: commands + hello + polling + probe interval | src/app.js |

## CONVENTIONS
- Chinese comments and Chinese emoji-heavy Telegram copy — keep this style in new code.
- Raw Telegram Bot API through `callTgApi`/axios. The `node-telegram-bot-api` dependency is **dead** — do not start using it.
- Hardcoded domain constants: cinema `VIV`, `areaCategory '0000000009'`, promo ticket codes `['5785','5759','6336']`.
- Persistence: read/mutate the live `subscriptions` array ONLY via `getSubscriptions()`/`setSubscriptions()` from src/store.js, call `saveSubscriptions` on change. No other state files. Do NOT cache a subscriptions reference across calls — `/del` replaces the array.
- Async flow: `main()` not awaited; both loops launched fire-and-forget. Never await `startTelegramPolling()` (infinite loop).
- Error style: TGV fetch errors → return null / empty and let callers degrade gracefully; `failCount`-based auto-removal (>=15).

## ANTI-PATTERNS (THIS PROJECT)
- **Never hardcode credentials.** `TG_BOT_TOKEN`/`TG_CHAT_ID` come from env or the out-of-repo file in src/config.js's CREDENTIALS section. Never print or commit them.
- callback_data now uses a `|` separator with IDs only (parsed by `parseCallback` in src/payload.js); the legacy `split('_')` scheme is still accepted for old messages but must not be used for new payloads. Keep encoded payloads underscore-free — an underscore can still corrupt the legacy-format fallback.
- A `node:test` suite lives in `test/` (unit + child-process, fully offline — axios is stubbed) and `npm test` runs it via `node --test`.
- Don't add new persistence files — extend the existing load/save pair.
- Don't change empty `catch {}` blocks into loggers without intent: they implement silent endpoint failover (try next endpoint / mark probe failed).

## COMMANDS
```bash
node monitor.js    # run the bot (long-running; Ctrl+C to stop)
npm install        # restore deps (axios, node-telegram-bot-api)
npm test           # node:test suite in test/ (offline; axios stubbed)
```
No build/lint/format tooling exists.

## NOTES
- TGV business day is Asia/Kuala_Lumpur; date math uses `en-CA` locale strings (YYYY-MM-DD).
- `subscriptions.json` is live runtime state: entries carry `alerted`/`failCount` — do not hand-edit while bot runs (load happens once at startup).
- `showTime` is `HH:MM` derived from `showtimemy` (substring 11-16 of the ISO string). Movie titles no longer travel in callback payloads (IDs only); they are recovered from `sessionCache` in src/store.js.
- `package.json` `main` is `monitor.js`; `npm start` runs the bot. Sole dependency is `axios` (`node-telegram-bot-api` was removed and pruned).
- Alert detection quirk: `quantityAvailablePerOrder > 0` AND description does NOT contain "Today's Promotion Limit Reached".