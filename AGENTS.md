# PROJECT KNOWLEDGE BASE

**Generated:** 2026-09-24
**Git:** `/root/tgv-monitor` is its own git repo (branch `master`), pushed to the PUBLIC remote `origin` -> https://github.com/hong-tm/tgv-monitor (MIT). The outer `/root` repository ignores `tgv-monitor/` via a `.gitignore` entry so the two `.git` directories do not collide.

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

Precedence caveat: the two files merge as `{ ...LOCAL_ENV_FILE, ...CRED_FILE }` (src/config.js), so the out-of-repo file wins over a local `.env`.
Live deployment (since 2026-09-25): the project-local `.env` is the active credential source; the former out-of-repo file was moved to `/root/.config/tgv-monitor/env.bak` (backup only, not read at runtime).

`assertCredentials()` runs at the top of `main()` (src/app.js) so a missing credential fails loudly at startup instead of surfacing later as a Telegram 404. To rotate: edit the file, then `pm2 startOrRestart ecosystem.config.js`.

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
| Telegram commands | `handleMessage` | src/handlers.js; /start /status /list /check /del. `/uuid` has no branch here, it falls through to smart input. `handlers.js` is now only the command router; `/start` help and `/list` rendering live in `views.js` |
| Smart text router | `classifyInput` / `handleSmartInput` | src/input-classifier.js; src/handlers.js; parsing now lives in `classifyInput`, `handleSmartInput` dispatches the result |
| Inline button actions | `handleCallbackQuery` | src/handlers.js; actions `refresh_dashboard showall quicksub pick del suball sub`. `handlers.js` is now only the router; rendering lives in `views.js` |
| TGV API calls | `fetchMovieByItemKey` / `fetchMovieSessions` / `fetchTickets` | src/tgv-api.js; MOVIE_BY_ITEMKEY to SESSIONS to TICKETS chain |
| Polling/alert logic | `runProbeCycle` | src/probe.js; dedup via `alerted` flag, auto-remove at 15 fails |
| Dashboard board | `sendRealtimeDashboard` | src/views.js |
| Persistence | `loadSubscriptions` / `saveSubscriptions` | src/store.js; synchronous fs, single state file |
| Bot command registration | `setupBotCommands` | src/telegram.js |
| Telegram transport | `callTgApi` / `notifyUser` | src/telegram.js; raw API, HTML parse_mode |
| Tests | `test/` | `npm test`; offline, axios stubbed, 48 tests |
| Process / ops | `ecosystem.config.js` | pm2 app name and script must match the live process |
## CODE MAP
Split across `src/`; `monitor.js` is a thin pm2 entry shim. It re-exports only `escapeHtml parseCallback runProbeCycle startTelegramPolling getSubscriptions setSubscriptions`, so `probeRunning`, `lastUpdateId`, `safeDecode`, `loadSubscriptions`, `saveSubscriptions`, `sessionCache`, `cacheSession`, `upsertSubscription`, `classifyInput`, `sendHelp`, `sendSubscriptionList` and `setupBotCommands` are reachable only through their own module.

| Symbol | Role | Module |
|--------|------|--------|
| `TG_BOT_TOKEN` `TG_CHAT_ID` | resolved from env or the credential files (see CREDENTIALS); never log/echo | src/config.js |
| `DATA_FILE` | subscriptions.json path | src/config.js |
| `assertCredentials` | startup guard, throws when a credential is missing | src/config.js |
| `CHECK_INTERVAL_MS` `COMMON_HEADERS` | 60s probe cadence; spoofed browser headers for api.tgv.com.my | src/config.js |
| `DEFAULT_AREA_CATEGORY` `PROMO_TICKET_CODES` | hardcoded TGV domain constants moved to config | src/config.js |
| `escapeHtml` | HTML-escape dynamic content before Telegram HTML messages | src/util.js |
| `safeDecode` / `parseCallback` | callback_data decode; parses the `|` separator plus legacy underscore format | src/payload.js |
| `classifyInput` | pure text→intent classifier (returns `empty|seat-link|movie-link|uuid|session|alias|search`), no I/O | src/input-classifier.js |
| `callTgApi` | axios POST to api.telegram.org, swallows errors, returns null | src/telegram.js |
| `notifyUser` | sendMessage with HTML + optional reply_markup | src/telegram.js |
| `setupBotCommands` | setMyCommands for the 5 slash commands | src/telegram.js |
| `loadSubscriptions` / `saveSubscriptions` | JSON file state; load creates an empty file if missing; save = full rewrite, sync | src/store.js |
| `getSubscriptions` / `setSubscriptions` | the ONLY accessors to the live `subscriptions` array | src/store.js |
| `sessionCache` / `cacheSession` | Map `${cinemaId}_${sessionId}` to {movieName, showTime}; FIFO cap 500, prefer cacheSession | src/store.js |
| `upsertSubscription` | find-or-create a sub keyed by `(sessionId, cinemaId)`; mutates memory ONLY, never persists (callers own `saveSubscriptions`) | src/store.js |
| `generateUserSessionId` / `getTodayBusinessDate` | per-request crypto session id; KL business date (en-CA, YYYY-MM-DD) | src/tgv-api.js |
| `fetchMovieByItemKey` | itemkey to movie recid; tries 2 endpoints, falls back to now-showing list | src/tgv-api.js |
| `fetchMovieSessions` | movieid+date+cinema to session list (time/screen/sessionId) | src/tgv-api.js |
| `fetchTickets` | session to ticket types (quota, priceInCents, promo flags); throws, no try/catch | src/tgv-api.js |
| `showSessionsByMovieId` | session picker keyboard | src/views.js |
| `showTicketSelection` | ticket-type picker keyboard + `/suball` promo shortcut | src/views.js |
| `sendRealtimeDashboard` | per-subscription ticket status board, editable + refresh button | src/views.js |
| `sendHelp` / `sendSubscriptionList` | the `/start` help copy and `/list` rendering, moved out of handlers | src/views.js |
| `handleSmartInput` | command-side dispatcher; real text parsing now lives in `classifyInput` | src/handlers.js |
| `handleMessage` | chat-id-gated command dispatch, falls back to smart input | src/handlers.js |
| `handleCallbackQuery` | all inline button routing | src/handlers.js |
| `probeRunning` / `runProbeCycle` | reentrancy guard; per-sub probe, alerts on quota>0 and !LimitReached, auto-remove at 15 fails | src/probe.js |
| `lastUpdateId` / `skipBacklog` | long-poll offset cursor; boot-time backlog drain via getUpdates offset:-1 | src/app.js |
| `startTelegramPolling` | infinite getUpdates long-poll loop; fire-and-forget | src/app.js |
| `main` | startup: assertCredentials, commands, hello, polling, probe interval | src/app.js |

## CONVENTIONS
- Code comments in English, low density (only what the code cannot convey). Telegram copy shown to users stays Chinese (emoji-heavy); keep that copy style.
- Transport is the raw Telegram Bot API through `callTgApi`/axios, not a bot library.
- Hardcoded domain constants: `DEFAULT_AREA_CATEGORY = '0000000009'` and `PROMO_TICKET_CODES = ['5785','5759','6336']` live in `src/config.js`; cinema `VIV` remains the default argument value in several functions. `src/views.js`'s inline `isPromo` predicate (used for the 🔥 emoji) is a DIFFERENT predicate from the `suball` promo filter and must stay separate.
- Persistence: read or mutate the live `subscriptions` array ONLY via `getSubscriptions()`/`setSubscriptions()` from src/store.js, and call `saveSubscriptions` on change. No other state files. Do NOT cache a subscriptions reference across calls, `/del` replaces the array.
- Async flow: `main()` is not awaited (monitor.js). Both boot loops launch fire-and-forget (src/app.js). Never await `startTelegramPolling()`, it is an infinite loop.
- Error style: TGV fetch errors return null or empty and callers degrade gracefully; probe failures bump `failCount` and auto-remove at 15.
- No lint, format, or build tooling exists, and there are no devDependencies. Do not introduce eslint/prettier/tsconfig and claim project precedent.
- pm2 runs one fork instance. ecosystem.config.js pins `NODE_OPTIONS=--dns-result-order=ipv4first` because api.telegram.org resolves AAAA and this host has no IPv6 route. `src/telegram.js` additionally pins the axios https agent to `family: 4` (same reason, and covers foreground runs without NODE_OPTIONS), and the `getUpdates` long-poll passes a 45s axios timeout because 35s left only ~5s slack over the 30s server hold on a lossy route.

## ANTI-PATTERNS (THIS PROJECT)
- Never hardcode credentials. `TG_BOT_TOKEN`/`TG_CHAT_ID` come from env or the credential files in src/config.js. Never print or commit them.
- New callback_data must use the `|` separator with IDs only (parsed by `parseCallback` in src/payload.js). The legacy underscore scheme is still accepted for old messages but must not be used for new payloads. Keep new payloads underscore-free, an underscore corrupts the legacy fallback. The one underscore literal is `refresh_dashboard`, special-cased at src/payload.js.
- All `callback_data` templates in `src/*.js` must stay as literal `` callback_data: `...` `` or `callback_data: '...'` strings. Do not introduce helper indirection. Any `${...}` interpolation inside those templates must use one of `movieId`, `targetDate`, `time`, `code`, `sessionId`, `cinemaId`; `test/unit.test.js` scrapes the source and throws on an unknown interpolation name.
- Do not change `name` or `script` in ecosystem.config.js. A mismatch spawns a second pm2 app and two pollers race `getUpdates` (409).
- Do not remove the 3s backoff in the polling loop (src/app.js). `callTgApi` returns null on failure, so without it the loop spins and hammers Telegram.
- Do not add new persistence files. Extend the existing load/save pair (src/store.js).
- Do not turn the empty `catch {}` blocks at src/tgv-api.js into loggers. They implement silent endpoint failover.
- Do not delete or weaken the `offset:-1` backlog drain in `skipBacklog` (src/app.js). It stops restarts from replaying old commands.

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
- Line numbers are deliberately omitted: they rot on every edit, so grep the symbol name instead.
- TGV business day is Asia/Kuala_Lumpur; date math uses `en-CA` locale strings (YYYY-MM-DD).
- `subscriptions.json` is live runtime state. Entries carry `alerted`/`failCount`, and load happens once at startup, so do not hand-edit while the bot runs.
- `test/unit.test.js` reads the real `subscriptions.json` and asserts its sha256 is unchanged, so the file must exist and must not be edited mid-run.
- `showTime` is `HH:MM` from `showtimemy` (substring 11-16). Movie titles do not travel in callback payloads; they are recovered from `sessionCache` in src/store.js.
- `package.json` `main` is `monitor.js`; the sole dependency is `axios`. `node-telegram-bot-api` was removed and is not installed.
- Alert detection quirk: `quantityAvailablePerOrder > 0` AND the description does not contain "Today's Promotion Limit Reached".
- The live pm2 app is `tgv-monitor`. Its id can shift (currently 1); only `name` and `script` matter for `startOrRestart` reuse.
- IPv4 transport pin verified in production on 2026-11-01 (pm2 restart, follow-redirects 1.16.1 loaded): the full pm2 error-log history contains zero IPv6-family failures (`ENETUNREACH`/`EAFNOSUPPORT`/`EAI_AGAIN`/`ECONNREFUSED`); every logged failure is a Telegram-side transient (502, 429, 45s timeout, `ECONNRESET`), and the `getUpdates` long-poll holds a live IPv4 connection to Telegram (149.154.166.110:443).

---

# Agent workflow (four beats)

四拍流程（isolate → build → prove → ship）、配套技能、多 agent 规矩与公开评论的署名规则都写在
`/root/.agents/reference/repo-workflow.md`，动手前读它。本仓库自己的部分只有下面两节。

Checks for this repo:

```bash
npm test          # node --test
```

Hard invariants:

- `subscriptions.json` is live subscriber state; do not rewrite it while testing, use `subscriptions.json.bak` for fixtures.

## Project review pilot

This pilot applies only to tgv-monitor. It supplements the four beats above;
its review-round limit takes precedence over an open-ended greploop for this
repository. Keep shared workflow files and upstream skills unchanged.

### Choose checks by impact

- Low: documentation or static copy with no behavior change. Review the diff
  and links; no runtime test or separate reviewer is needed for prose alone.
- Normal: parsing, ticket selection, or dashboard behavior. Run the relevant
  offline tests and `npm test`, then use one fresh-context reviewer before
  handing off. Reuse an existing reviewer rather than adding a second panel.
- High: chat authorization, credentials, notification delivery or deduplication,
  subscription persistence/deletion, polling/restart behavior, dependencies,
  CI, or process configuration. Add a focused failure-path and security review
  to the normal checks. For dependency changes, assess `npm audit` separately
  from the AI review; a clean result from either is not proof of safety.

The tier controls review depth only. Push, PR publication, merge, live Telegram
messages, and production changes still require the user's task-specific
authorization, including for low-risk changes.

### Review evidence and convergence

Give the reviewer the intended behavior, diff, relevant invariants above, and
test commands with their actual results. Focus on missed or duplicate alerts,
unintended subscription changes, unauthorized commands, and polling recovery
when those behaviors are touched. Use offline stubs or temporary fixtures;
keep live state and credentials out of review artifacts.

Each finding needs a file/line, a concrete trigger, and an impact. Separate
new regressions from pre-existing issues. Fix confirmed in-scope defects;
record a reason for rejected findings and report unrelated issues separately.

Use at most three review passes per change across local and remote reviewers.
After the first pass, review the new diff and its affected callers, and verify
previous fixes without repeating resolved findings. At three passes, or when
the same disputed finding recurs without new evidence, stop automatic edits
and present the remaining findings to the user. A reviewer failure is not an
approval: report missing independent review rather than claiming a clean pass.
The cap never clears failing checks or unresolved release-blocking defects.

### Handoff and trial feedback

Report the risk tier and reason, changed behavior, commands and results tied
to the reviewed revision or working diff, unresolved findings, and how to undo
the change. For stateful changes, distinguish reverting code from restoring
data. Recheck affected behavior when the diff changes; do not reuse stale proof.

Include review-pass count and rejected-finding count in the task handoff so
the user can judge whether this pilot reduces rework. Treat a confirmed escaped
bug as a candidate regression test for the existing test suite.
