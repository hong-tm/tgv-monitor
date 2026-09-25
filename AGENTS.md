# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-24
**Commit:** `22199f5` (branch `master`)
**Git:** `/root/tgv-monitor` is its own git repo (branch `master`, no remote). The outer `/root` repository ignores `tgv-monitor/` via a `.gitignore` entry so the two `.git` directories do not collide.

## OVERVIEW
Node.js (CommonJS) Telegram bot that monitors ticket availability for TGV,
a Malaysian cinema chain (tgv.com.my). Polls the TGV boxoffice API every 60s and
alerts the owner via Telegram when monitored promo tickets gain sellable quota.
Stack: axios + raw Telegram Bot API over long-polling.
Was a single 826-line file; split into `src/` modules in step 2 (`monitor.js` is now a 20-line entry shim; `src/` now holds 11 modules, 987 lines; repo total 2079 lines).

## CREDENTIALS
Bot token and chat id are NOT in the repo. `src/config.js` resolves them in this order:
1. env `TG_BOT_TOKEN` / `TG_CHAT_ID`
2. a dotenv-style file at `$TGV_ENV_FILE` (default `/root/.config/tgv-monitor/env`, mode 600, outside the git repo)
3. project-local `.env` (gitignored; template in `.env.example`)

Precedence caveat: the two files merge as `{ ...LOCAL_ENV_FILE, ...CRED_FILE }` (src/config.js:28), so the out-of-repo file wins over a local `.env`.

`assertCredentials()` runs at the top of `main()` (src/app.js:48) so a missing credential fails loudly at startup instead of surfacing later as a Telegram 404. To rotate: edit the file, then `pm2 startOrRestart ecosystem.config.js`.

```
tgv-monitor/
├── monitor.js            # 20 lines: pm2 entry shim only; require.main guard + 6 re-exports
├── src/                  # 11 modules, 987 lines
│   ├── config.js         # 66 lines: TG_BOT_TOKEN, TG_CHAT_ID, CHECK_INTERVAL_MS, DATA_FILE, COMMON_HEADERS, DEFAULT_AREA_CATEGORY, PROMO_TICKET_CODES, assertCredentials
│   ├── util.js           # 12 lines: escapeHtml
│   ├── payload.js        # 50 lines: safeDecode, parseCallback
│   ├── input-classifier.js  # 47 lines: classifyInput; text → intent (empty/seat-link|movie-link|uuid|session|alias|search)
│   ├── telegram.js       # 47 lines: callTgApi, notifyUser, setupBotCommands
│   ├── tgv-api.js        # 104 lines: generateUserSessionId, getTodayBusinessDate, fetchMovieByItemKey/Sessions/Tickets
│   ├── store.js          # 74 lines: subscriptions (get/set accessors), sessionCache, cacheSession, upsertSubscription; load/save
│   ├── views.js          # 177 lines: showSessionsByMovieId, showTicketSelection, sendRealtimeDashboard, sendHelp, sendSubscriptionList
│   ├── handlers.js       # 263 lines: command/action router; handleSmartInput, handleMessage, handleCallbackQuery
│   ├── probe.js          # 85 lines: probeRunning, runProbeCycle
│   └── app.js            # 62 lines: lastUpdateId, skipBacklog, startTelegramPolling, main
├── test/                 # 5 files, 1072 lines; node:test, offline (axios stubbed), 48 tests
│   ├── child-process.test.js              # 73 lines: CLI / entry-shim smoke tests
│   ├── classifier.test.js                 # 161 lines: classifyInput unit tests
│   ├── handlers-characterization.test.js  # 531 lines: handler integration / characterization tests
│   ├── store.test.js                      # 129 lines: store accessor and upsertSubscription tests
│   └── unit.test.js                       # 178 lines: callback_data byte-budget + source-level invariants
├── ecosystem.config.js   # pm2: name tgv-monitor, fork, NODE_OPTIONS ipv4first
├── package.json          # commonjs; main monitor.js; sole dep axios ^1.20.0
├── package-lock.json
├── .env.example          # credential template (TG_BOT_TOKEN, TG_CHAT_ID)
├── .gitignore            # ignores .env, subscriptions.json.bak, node_modules/, .codegraph/
├── subscriptions.json    # untracked runtime state (gitignored; mutated live by bot)
└── .omo/                 # agent session state, not project code
```
Dependency direction (acyclic): `config`/`util`/`payload`/`input-classifier` → none; `telegram`/`tgv-api`/`store` → config (`store` imports `DATA_FILE` and `DEFAULT_AREA_CATEGORY`);
`views` → telegram, tgv-api, store, util, config; `handlers` → telegram, tgv-api, store, payload, views, util, config, input-classifier;
`probe` → telegram, tgv-api, store, util; `app` → telegram, handlers, probe, config;
`monitor.js` (shim) → app, probe, util, payload, store.

| Task | Location | Notes |
|------|----------|-------|
| Any new feature | `src/` modules | pick the module owning the concern; keep the shim thin |
| Telegram commands | `handleMessage` | src/handlers.js:91; /start /status /list /check /del. `/uuid` has no branch here, it falls through to smart input. `handlers.js` is now only the command router; `/start` help and `/list` rendering live in `views.js` |
| Smart text router | `classifyInput` / `handleSmartInput` | src/input-classifier.js:2; src/handlers.js:10; parsing now lives in `classifyInput`, `handleSmartInput` dispatches the result |
| Inline button actions | `handleCallbackQuery` | src/handlers.js:144; actions `refresh_dashboard showall quicksub pick del suball sub`. `handlers.js` is now only the router; rendering lives in `views.js` |
| TGV API calls | `fetchMovieByItemKey` / `fetchMovieSessions` / `fetchTickets` | src/tgv-api.js; MOVIE_BY_ITEMKEY to SESSIONS to TICKETS chain |
| Polling/alert logic | `runProbeCycle` | src/probe.js:7; dedup via `alerted` flag, auto-remove at 15 fails |
| Dashboard board | `sendRealtimeDashboard` | src/views.js:89 |
| Persistence | `loadSubscriptions` / `saveSubscriptions` | src/store.js:4,17; synchronous fs, single state file |
| Bot command registration | `setupBotCommands` | src/telegram.js:30 |
| Telegram transport | `callTgApi` / `notifyUser` | src/telegram.js; raw API, HTML parse_mode |
| Tests | `test/` | `npm test`; offline, axios stubbed, 48 tests |
| Process / ops | `ecosystem.config.js` | pm2 app name and script must match the live process |
## CODE MAP
Split across `src/`; `monitor.js` is a thin pm2 entry shim. It re-exports only `escapeHtml parseCallback runProbeCycle startTelegramPolling getSubscriptions setSubscriptions`, so `probeRunning`, `lastUpdateId`, `safeDecode`, `loadSubscriptions`, `saveSubscriptions`, `sessionCache`, `cacheSession`, `upsertSubscription`, `classifyInput`, `sendHelp`, `sendSubscriptionList` and `setupBotCommands` are reachable only through their own module.

| Symbol | Role | Module |
|--------|------|--------|
| `TG_BOT_TOKEN` `TG_CHAT_ID` | resolved from env or the credential files (see CREDENTIALS); never log/echo | src/config.js:30,31 |
| `DATA_FILE` | subscriptions.json path | src/config.js:34 |
| `assertCredentials` | startup guard, throws when a credential is missing | src/config.js:48 |
| `CHECK_INTERVAL_MS` `COMMON_HEADERS` | 60s probe cadence; spoofed browser headers for api.tgv.com.my | src/config.js:33,36 |
| `DEFAULT_AREA_CATEGORY` `PROMO_TICKET_CODES` | hardcoded TGV domain constants moved to config | src/config.js:44,45 |
| `escapeHtml` | HTML-escape dynamic content before Telegram HTML messages | src/util.js:2 |
| `safeDecode` / `parseCallback` | callback_data decode; parses the `|` separator plus legacy underscore format | src/payload.js:2,11 |
| `classifyInput` | pure text→intent classifier (returns `empty|seat-link|movie-link|uuid|session|alias|search`), no I/O | src/input-classifier.js:2 |
| `callTgApi` | axios POST to api.telegram.org, swallows errors, returns null | src/telegram.js:9 |
| `notifyUser` | sendMessage with HTML + optional reply_markup | src/telegram.js:20 |
| `setupBotCommands` | setMyCommands for the 5 slash commands | src/telegram.js:30 |
| `loadSubscriptions` / `saveSubscriptions` | JSON file state; load creates an empty file if missing; save = full rewrite, sync | src/store.js:4,17 |
| `getSubscriptions` / `setSubscriptions` | the ONLY accessors to the live `subscriptions` array | src/store.js:35,39 |
| `sessionCache` / `cacheSession` | Map `${cinemaId}_${sessionId}` to {movieName, showTime}; FIFO cap 500, prefer cacheSession | src/store.js:23,27 |
| `upsertSubscription` | find-or-create a sub keyed by `(sessionId, cinemaId)`; mutates memory ONLY, never persists (callers own `saveSubscriptions`) | src/store.js:44 |
| `generateUserSessionId` / `getTodayBusinessDate` | per-request crypto session id; KL business date (en-CA, YYYY-MM-DD) | src/tgv-api.js:5,9 |
| `fetchMovieByItemKey` | itemkey to movie recid; tries 2 endpoints, falls back to now-showing list | src/tgv-api.js:13 |
| `fetchMovieSessions` | movieid+date+cinema to session list (time/screen/sessionId) | src/tgv-api.js:42 |
| `fetchTickets` | session to ticket types (quota, priceInCents, promo flags); throws, no try/catch | src/tgv-api.js:84 |
| `showSessionsByMovieId` | session picker keyboard | src/views.js:7 |
| `showTicketSelection` | ticket-type picker keyboard + `/suball` promo shortcut | src/views.js:48 |
| `sendRealtimeDashboard` | per-subscription ticket status board, editable + refresh button | src/views.js:89 |
| `sendHelp` / `sendSubscriptionList` | the `/start` help copy and `/list` rendering, moved out of handlers | src/views.js:142,155 |
| `handleSmartInput` | command-side dispatcher; real text parsing now lives in `classifyInput` | src/handlers.js:10 |
| `handleMessage` | chat-id-gated command dispatch, falls back to smart input | src/handlers.js:91 |
| `handleCallbackQuery` | all inline button routing | src/handlers.js:144 |
| `probeRunning` / `runProbeCycle` | reentrancy guard; per-sub probe, alerts on quota>0 and !LimitReached, auto-remove at 15 fails | src/probe.js:6,7 |
| `lastUpdateId` / `skipBacklog` | long-poll offset cursor; boot-time backlog drain via getUpdates offset:-1 | src/app.js:6,10 |
| `startTelegramPolling` | infinite getUpdates long-poll loop; fire-and-forget | src/app.js:17 |
| `main` | startup: assertCredentials, commands, hello, polling, probe interval | src/app.js:47 |

## CONVENTIONS
- Code comments in English, low density (only what the code cannot convey). Telegram copy shown to users stays Chinese (emoji-heavy); keep that copy style.
- Transport is the raw Telegram Bot API through `callTgApi`/axios, not a bot library.
- Hardcoded domain constants: `DEFAULT_AREA_CATEGORY = '0000000009'` and `PROMO_TICKET_CODES = ['5785','5759','6336']` live in `src/config.js`; cinema `VIV` remains the default argument value in several functions. `src/views.js`'s inline `isPromo` predicate (used for the 🔥 emoji) is a DIFFERENT predicate from the `suball` promo filter and must stay separate.
- Persistence: read or mutate the live `subscriptions` array ONLY via `getSubscriptions()`/`setSubscriptions()` from src/store.js:35,39, and call `saveSubscriptions` on change. No other state files. Do NOT cache a subscriptions reference across calls, `/del` replaces the array.
- Async flow: `main()` is not awaited (monitor.js:10). Both boot loops launch fire-and-forget (src/app.js:53-55). Never await `startTelegramPolling()`, it is an infinite loop.
- Error style: TGV fetch errors return null or empty and callers degrade gracefully; probe failures bump `failCount` and auto-remove at 15.
- No lint, format, or build tooling exists, and there are no devDependencies. Do not introduce eslint/prettier/tsconfig and claim project precedent.
- pm2 runs one fork instance. ecosystem.config.js pins `NODE_OPTIONS=--dns-result-order=ipv4first` because api.telegram.org resolves AAAA and this host has no IPv6 route. `src/telegram.js` additionally pins the axios https agent to `family: 4` (same reason, and covers foreground runs without NODE_OPTIONS), and the `getUpdates` long-poll passes a 45s axios timeout because 35s left only ~5s slack over the 30s server hold on a lossy route.

## ANTI-PATTERNS (THIS PROJECT)
- Never hardcode credentials. `TG_BOT_TOKEN`/`TG_CHAT_ID` come from env or the credential files in src/config.js:28. Never print or commit them.
- New callback_data must use the `|` separator with IDs only (parsed by `parseCallback` in src/payload.js:11). The legacy underscore scheme is still accepted for old messages but must not be used for new payloads. Keep new payloads underscore-free, an underscore corrupts the legacy fallback. The one underscore literal is `refresh_dashboard`, special-cased at src/payload.js:13.
- All `callback_data` templates in `src/*.js` must stay as literal `` callback_data: `...` `` or `callback_data: '...'` strings. Do not introduce helper indirection. Any `${...}` interpolation inside those templates must use one of `movieId`, `targetDate`, `time`, `code`, `sessionId`, `cinemaId`; `test/unit.test.js` scrapes the source and throws on an unknown interpolation name.
- Do not change `name` or `script` in ecosystem.config.js. A mismatch spawns a second pm2 app and two pollers race `getUpdates` (409).
- Do not remove the 3s backoff in the polling loop (src/app.js:39,42). `callTgApi` returns null on failure, so without it the loop spins and hammers Telegram.
- Do not add new persistence files. Extend the existing load/save pair (src/store.js:4,17).
- Do not turn the empty `catch {}` blocks at src/tgv-api.js:27,37 into loggers. They implement silent endpoint failover.
- Do not delete or weaken the `offset:-1` backlog drain in `skipBacklog` (src/app.js:11). It stops restarts from replaying old commands.

## COMMANDS
```bash
node monitor.js              # run the bot in foreground (long-running)
npm start                    # same as node monitor.js
npm install                  # restore deps (axios only)
npm test                     # node --test; test/ offline, axios stubbed, 48 tests
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