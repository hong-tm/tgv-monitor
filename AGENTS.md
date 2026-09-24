# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-24
**Commit:** `8cf9f29` (branch `master`)
**Git:** repo root is `/root` (no remote); project dir is `tgv-monitor/`.

## OVERVIEW
Node.js (CommonJS) Telegram bot that monitors ticket availability for TGV,
a Malaysian cinema chain (tgv.com.my). Polls the TGV boxoffice API every 60s and
alerts the owner via Telegram when monitored promo tickets gain sellable quota.
Stack: axios + raw Telegram Bot API over long-polling.
Was a single 826-line file; split into `src/` modules in step 2 (`monitor.js` is now a 20-line entry shim).

## CREDENTIALS
Bot token and chat id are NOT in the repo. `src/config.js` resolves them in this order:
1. env `TG_BOT_TOKEN` / `TG_CHAT_ID`
2. a dotenv-style file at `$TGV_ENV_FILE` (default `/root/.config/tgv-monitor/env`, mode 600, outside the git repo)
3. project-local `.env` (gitignored; template in `.env.example`)

Precedence caveat: the two files merge as `{ ...LOCAL_ENV_FILE, ...CRED_FILE }` (src/config.js:29), so the out-of-repo file wins over a local `.env`.

`assertCredentials()` runs at the top of `main()` (src/app.js:49) so a missing credential fails loudly at startup instead of surfacing later as a Telegram 404. To rotate: edit the file, then `pm2 startOrRestart ecosystem.config.js`.

## STRUCTURE
```
tgv-monitor/
├── monitor.js            # pm2 entry shim only (20 lines): require.main guard + 6 re-exports
├── src/                  # 10 modules, 966 lines
│   ├── config.js         # TG_BOT_TOKEN, TG_CHAT_ID, CHECK_INTERVAL_MS, DATA_FILE, COMMON_HEADERS, assertCredentials
│   ├── util.js           # escapeHtml
│   ├── payload.js        # safeDecode, parseCallback
│   ├── telegram.js       # callTgApi, notifyUser, setupBotCommands
│   ├── tgv-api.js        # generateUserSessionId, getTodayBusinessDate, fetchMovieByItemKey/Sessions/Tickets
│   ├── store.js          # subscriptions (get/set accessors) + sessionCache; load/save
│   ├── views.js          # showSessionsByMovieId, showTicketSelection, sendRealtimeDashboard
│   ├── handlers.js       # handleSmartInput, handleMessage, handleCallbackQuery (346 lines, the hub)
│   ├── probe.js          # probeRunning, runProbeCycle
│   └── app.js            # lastUpdateId, skipBacklog, startTelegramPolling, main
├── test/                 # node:test, offline (axios stubbed): unit / store / child-process
├── ecosystem.config.js   # pm2: name tgv-monitor, fork, NODE_OPTIONS ipv4first
├── package.json          # commonjs; main monitor.js; sole dep axios ^1.20.0
├── package-lock.json
├── .env.example          # credential template (TG_BOT_TOKEN, TG_CHAT_ID)
├── .gitignore            # ignores .env, subscriptions.json.bak, node_modules/, .codegraph/
├── subscriptions.json    # runtime state: monitored sessions (mutated live by bot)
└── .omo/                 # agent session state, not project code
```
Dependency direction (acyclic): `config`/`util`/`payload` → none; `telegram`/`tgv-api`/`store` → config;
`views` → telegram, tgv-api, store, util, config; `handlers` → telegram, tgv-api, store, payload, views, util, config;
`probe` → telegram, tgv-api, store, util; `app` → telegram, handlers, probe, config;
`monitor.js` (shim) → app, probe, util, payload, store.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Any new feature | `src/` modules | pick the module owning the concern; keep the shim thin |
| Telegram commands | `handleMessage` | src/handlers.js:116; /start /status /list /check /del. `/uuid` has no branch here, it falls through to smart input |
| Smart text router | `handleSmartInput` | src/handlers.js:10; seat link, movie link, UUID, numeric session, alias, plain search |
| Inline button actions | `handleCallbackQuery` | src/handlers.js:191; actions `refresh_dashboard showall quicksub pick del suball sub` |
| TGV API calls | `fetchMovieByItemKey` / `fetchMovieSessions` / `fetchTickets` | src/tgv-api.js; MOVIE_BY_ITEMKEY to SESSIONS to TICKETS chain |
| Polling/alert logic | `runProbeCycle` | src/probe.js:8; dedup via `alerted` flag, auto-remove at 15 fails |
| Dashboard board | `sendRealtimeDashboard` | src/views.js:92 |
| Persistence | `loadSubscriptions` / `saveSubscriptions` | src/store.js; synchronous fs, single state file |
| Bot command registration | `setupBotCommands` | src/telegram.js:26 |
| Telegram transport | `callTgApi` / `notifyUser` | src/telegram.js; raw API, HTML parse_mode |
| Tests | `test/` | `npm test`; offline, axios stubbed |
| Process / ops | `ecosystem.config.js` | pm2 app name and script must match the live process |

## CODE MAP
Split across `src/`; `monitor.js` is a thin pm2 entry shim. It re-exports only `escapeHtml parseCallback runProbeCycle startTelegramPolling getSubscriptions setSubscriptions`, so `probeRunning`, `lastUpdateId`, `safeDecode`, `loadSubscriptions`, `saveSubscriptions`, `sessionCache`, `cacheSession` and `setupBotCommands` are reachable only through their own module.

| Symbol | Role | Module |
|--------|------|--------|
| `TG_BOT_TOKEN` `TG_CHAT_ID` | resolved from env or the credential files (see CREDENTIALS); never log/echo | src/config.js:29 |
| `DATA_FILE` | subscriptions.json path | src/config.js:33 |
| `assertCredentials` | startup guard, throws when a credential is missing | src/config.js:44 |
| `CHECK_INTERVAL_MS` `COMMON_HEADERS` | 60s probe cadence; spoofed browser headers for api.tgv.com.my | src/config.js:32,35 |
| `escapeHtml` | HTML-escape dynamic content before Telegram HTML messages | src/util.js:2 |
| `safeDecode` / `parseCallback` | callback_data decode; parses the pipe-separated new format plus legacy underscore format | src/payload.js:2,11 |
| `callTgApi` | axios POST to api.telegram.org, swallows errors, returns null | src/telegram.js:5 |
| `notifyUser` | sendMessage with HTML + optional reply_markup | src/telegram.js:16 |
| `setupBotCommands` | setMyCommands for the 5 slash commands | src/telegram.js:26 |
| `loadSubscriptions` / `saveSubscriptions` | JSON file state; load creates an empty file if missing; save = full rewrite, sync | src/store.js:4,17 |
| `getSubscriptions` / `setSubscriptions` | the ONLY accessors to the live `subscriptions` array | src/store.js:35,39 |
| `sessionCache` / `cacheSession` | Map `${cinemaId}_${sessionId}` to {movieName, showTime}; FIFO cap 500, prefer cacheSession | src/store.js:23,27 |
| `generateUserSessionId` / `getTodayBusinessDate` | per-request crypto session id; KL business date (en-CA, YYYY-MM-DD) | src/tgv-api.js:5,9 |
| `fetchMovieByItemKey` | itemkey to movie recid; tries 2 endpoints, falls back to now-showing list | src/tgv-api.js:14 |
| `fetchMovieSessions` | movieid+date+cinema to session list (time/screen/sessionId) | src/tgv-api.js:44 |
| `fetchTickets` | session to ticket types (quota, priceInCents, promo flags); throws, no try/catch | src/tgv-api.js:87 |
| `showSessionsByMovieId` | session picker keyboard | src/views.js:8 |
| `showTicketSelection` | ticket-type picker keyboard + `/suball` promo shortcut | src/views.js:50 |
| `sendRealtimeDashboard` | per-subscription ticket status board, editable + refresh button | src/views.js:92 |
| `handleSmartInput` | text router: seat link, movie link, UUID, numeric session, alias, plain search | src/handlers.js:10 |
| `handleMessage` | chat-id-gated command dispatch, falls back to smart input | src/handlers.js:116 |
| `handleCallbackQuery` | all inline button routing | src/handlers.js:191 |
| `probeRunning` / `runProbeCycle` | reentrancy guard; per-sub probe, alerts on quota>0 and !LimitReached, auto-remove at 15 fails | src/probe.js:7,8 |
| `lastUpdateId` / `skipBacklog` | long-poll offset cursor; boot-time backlog drain via getUpdates offset:-1 | src/app.js:7,11 |
| `startTelegramPolling` | infinite getUpdates long-poll loop; fire-and-forget | src/app.js:18 |
| `main` | startup: assertCredentials, commands, hello, polling, probe interval | src/app.js:48 |

## CONVENTIONS
- Chinese comments and Chinese emoji-heavy Telegram copy. Keep this style in new code.
- Transport is the raw Telegram Bot API through `callTgApi`/axios, not a bot library.
- Hardcoded domain constants: cinema `VIV`, `areaCategory '0000000009'`, promo ticket codes `['5785','5759','6336']`.
- Persistence: read or mutate the live `subscriptions` array ONLY via `getSubscriptions()`/`setSubscriptions()` from src/store.js, and call `saveSubscriptions` on change. No other state files. Do NOT cache a subscriptions reference across calls, `/del` replaces the array.
- Async flow: `main()` is not awaited (monitor.js:10). Both boot loops launch fire-and-forget (src/app.js:54-56). Never await `startTelegramPolling()`, it is an infinite loop.
- Error style: TGV fetch errors return null or empty and callers degrade gracefully; probe failures bump `failCount` and auto-remove at 15.
- No lint, format, or build tooling exists, and there are no devDependencies. Do not introduce eslint/prettier/tsconfig and claim project precedent.
- pm2 runs one fork instance. ecosystem.config.js pins `NODE_OPTIONS=--dns-result-order=ipv4first` because api.telegram.org resolves AAAA and this host has no IPv6 route.

## ANTI-PATTERNS (THIS PROJECT)
- Never hardcode credentials. `TG_BOT_TOKEN`/`TG_CHAT_ID` come from env or the credential files in src/config.js. Never print or commit them.
- New callback_data must use the `|` separator with IDs only (parsed by `parseCallback` in src/payload.js). The legacy underscore scheme is still accepted for old messages but must not be used for new payloads. Keep new payloads underscore-free, an underscore corrupts the legacy fallback. The one underscore literal is `refresh_dashboard`, special-cased at src/payload.js:13.
- Do not change `name` or `script` in ecosystem.config.js. A mismatch spawns a second pm2 app and two pollers race `getUpdates` (409).
- Do not remove the 3s backoff in the polling loop (src/app.js:39-43). `callTgApi` returns null on failure, so without it the loop spins and hammers Telegram.
- Do not add new persistence files. Extend the existing load/save pair.
- Do not turn the empty `catch {}` blocks at src/tgv-api.js:28,38 into loggers. They implement silent endpoint failover.
- Do not delete or weaken the `offset:-1` backlog drain in `skipBacklog` (src/app.js:11). It stops restarts from replaying old commands.

## COMMANDS
```bash
node monitor.js              # run the bot in foreground (long-running)
npm start                    # same as node monitor.js
npm install                  # restore deps (axios only)
npm test                     # node --test; test/ offline, axios stubbed, 11 tests
pm2 startOrRestart ecosystem.config.js   # (re)start under pm2
```
No build, lint, or format tooling exists.

## NOTES
- TGV business day is Asia/Kuala_Lumpur; date math uses `en-CA` locale strings (YYYY-MM-DD).
- `subscriptions.json` is live runtime state. Entries carry `alerted`/`failCount`, and load happens once at startup, so do not hand-edit while the bot runs.
- `test/unit.test.js` reads the real `subscriptions.json` and asserts its sha256 is unchanged, so the file must exist and must not be edited mid-run.
- `showTime` is `HH:MM` from `showtimemy` (substring 11-16). Movie titles do not travel in callback payloads; they are recovered from `sessionCache` in src/store.js.
- `package.json` `main` is `monitor.js`; the sole dependency is `axios`. `node-telegram-bot-api` was removed and is not installed.
- Alert detection quirk: `quantityAvailablePerOrder > 0` AND the description does not contain "Today's Promotion Limit Reached".
- The live pm2 app is `tgv-monitor`. Its id can shift (currently 2); only `name` and `script` matter for `startOrRestart` reuse.