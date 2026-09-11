# Workspace Review — Charqueadas Weather Monitoring `ifsul/weather`
**Date:** 2026-08-31 (Sun) — branch `feat/admin-invite-codes:b455b43..8da4ab1..ffffe69..42114ca..4c08c3e..b9966b1` → `main` merge-base `94627d4`
**Auditor:** OpenCode (Muse Spark) — full codebase static read + `docker run node --test` (113 tests)
**Goal:** Map *everything* individually, check against `AGENTS.md` / `ALERT_METHODOLOGY.md` / code, list stale docs & operational gaps.

---

## 1. Repository Overview

* **Purpose:** 24/7 meteorological risk monitoring for Charqueadas-RS (IBGE `4305355`, lat `-29.95` lon `-51.62`, 38 municipalities 0–100km) fusing **INMET** forecasts/warnings + **Defesa Civil RS** GraphQL telemetry, alerting via **grammY** Telegram bot.
* **Stack:** Node.js 26 Alpine (Docker, ESM `.js` + `.js` extensions, native `fetch`, native `node:test`, `DatabaseSync` SQLite), `grammy@1.45.1` single prod dep `package.json:24`, `system_settings` SQLite source of truth.
* **File count:** 12 `src/*.js`, 7 `migrations/*.sql`, 8 `tests/*.test.js`, 5 `docs/*.md`, 4 compose/docker/package, 6 skills (18 SKILL.md refs). Total ~855 files inc. `node_modules`.

---

## 2. Module Map — `src/` (12 files, individually checked)

### 2.1 `src/model/admin_store.js` — 430 LOC (new, not in `AGENTS.md:71`)
**Exports:** `INVITE_CODE_LENGTH=8`, `INVITE_CODE_CHARSET`, `INVITE_CODE_REGEX=/^[A-Z0-9]{8}$/`, `INVITE_EXPIRY_MS=300000`, `hashInviteCode()`, `generateInviteCode()`, `normalizeInviteCode()`, `isValidInviteCodeFormat()`, `extractInviteCodeFromText()`, `getPersistedAdminChatIds()`, `addPersistedAdminChatId()`, `removePersistedAdminChatId()`, `getActiveInviteCode()`, `getActiveInvites()`, `createAdminInviteCode()`, `clearInviteCode()`, `consumeInviteCode()` (`reasons` `invalid_format|invalid_chat_id|already_admin|invalid_code|expired|revoked|error`).

**Flow:** `randomInt` → `normalize` → `hash(sha256)` → `code_hash+code_prefix` → `Sqlite.withTransaction` insert `admin_invites`; `consume` extract→hash→txn checks `revoked/used/expires_at` → `upsert admin_users` + `update used_by`.

**Findings:**
* Overloaded `options`/`customDriver` duck-type `admin_store.js:119,348` — KISS violation.
* `withTransaction` uses static `Sqlite` not `customDriver` — test mock leak.
* `extractInviteCodeFromText` `match(/[A-Z0-9]{8}/)` false positive on longer token, no word boundary.
* Plaintext `code_plain` stored alongside hash defeats hashing.
* `clearInviteCode` revokes all via `used_by IS NULL` then fallback `find` without filter — inconsistent.

### 2.2 `src/helpers/database_driver.js` — 623 LOC (core, correct boundary)
**Exports:** `DatabaseError`, `Sqlite` static: `connect()`, `close()`, `ping()`, `exec()`, `insert()`, `upsert()`, `update()`, `delete()`, `find()`, `findOne()`, `get()`, `count()`, `getWhereStatements()`, `withTransaction()`, `raw()`, `formatRaw()`, `format()`, helpers `like/between/ne/lt/gt`.

**Findings:**
* Global singleton `connected/connection` `37` — parallel test leak, `connect` ignores `path` if already connected.
* `delete` with `limit` assumes PK `id` — fails on `schema_migrations(version)`.
* `getWhereStatements` whitelist missing `like` branch — already handled but `throw 400` leaks.
* `formatRaw` splits on `?` fails if `?` inside string literal.
* `withTransaction` uses `BEGIN TRANSACTION` not `IMMEDIATE`, no retry on `SQLITE_BUSY`.

### 2.3 `src/clients/defesa_civil_client.js` — 316 LOC
**Exports:** `DEFESA_CIVIL_GRAPHQL_URL`, `CHARQUEADAS_STATION_CODE='DCRS-00032'`, `REGIONAL_STATIONS[6]` with `alertLevelM/floodLevelM`, `TAGS_DATA_QUERY`, `getDefesaCivilTelemetry()`, `evaluateDefesaCivilRisks()`.

**Findings:**
* `parseFloat(...rio_nivel.value) || null` → `0` (sea level) coerced to `null` → skipped.
* Hard-coded thresholds `rain1h>=50` etc without constants; quota provenance provisional (`4.05m` upper bound) — risk of false absolute alerts.
* Default stations `['DCRS-00032','00093','00076','00054']` omits `00033,00122` defined in `REGIONAL_STATIONS`.
* No `AbortSignal` timeout — can block 24/7 loop.

### 2.4 `src/clients/inmet_client.js` — 297 LOC
**Exports:** `CHARQUEADAS_IBGE_CODE`, `BASE_PREVMET_URL`, `BASE_TEMPO_URL`, `BASE_IBGE_API_URL`, `CHARQUEADAS_SURROUNDING_CITIES_100KM[38]`, `httpGet()`, `getSurroundingCities()`, `getCityForecast()`, `getRegionalForecasts()`, `getActiveRiskWarnings()`, `getRegionalRiskWarnings()`, `getAutomaticStations()`, `getAlertEmoji()`.

**Findings:**
* `httpGet` error-logic suppresses HTTP errors incorrectly via `startsWith('HTTP error')`.
* `getSurroundingCities` async but sync — misleading.
* `CHARQUEADAS_SURROUNDING_CITIES` alias duplicate — YAGNI.
* `getCityForecast` returns `{}` on 404 — masks error, downstream must detect `Object.keys===0`.
* `getAlertEmoji` strict `=== '#FF0000'` but `toUpperCase` fixes, duplication with `risk_analyzer`.

### 2.5 `src/model/log_database.js` — 653 LOC (largest, SRP violation)
**Exports:** `DEFAULT_DB_PATH`, `getDatabase()`, `extractEndpoint()`, `logFetch()`, `logAlert()`, `logMonitorCycle()`, `getRecentFetchLogs()`, `getRecentAlertLogs()`, `getFetchStats()`, `saveSystemSetting()`, `getSystemSetting()`, `logUnknownAlert()`, `loadAllSettings()`, `getLogRetentionHours()`, `cleanupOldLogs()`, `closeDatabase()` + CLI.

**Findings:**
* Duplicate env fallback `DEFAULT_DB_PATH` vs `targetPath` drift risk.
* `logUnknownAlert` `db.find(...,{limit:1})` should be `opt:{limit:1}` — fetches all.
* `cleanupOldLogs` string interpolation `DELETE ... WHERE "${col}" < '${cutoff}'` — cutoff is ISO but pattern violates param quoting; `inviteCutoff` computed but never used, reuses `cutoff`.
* Orphaned doc block before `saveSystemSetting` (actually `closeDatabase`).
* 5 concerns in one file — should split.

### 2.6 `src/helpers/migrate.js` — 152 LOC
**Exports:** `DEFAULT_MIGRATIONS_DIR`, `splitSqlStatements()`, `migrateSync()`, `migrate()`.

**Findings:**
* `splitSqlStatements` `replace(/--.*$/gm,'')` removes `--` inside string literals, `split(';')` fails for `;` inside strings.
* `find('schema_migrations', {}, {view:['version']})` wrong API — second arg should be filter.
* `localeCompare numeric` locale-dependent, no checksum verification.

### 2.7 `scripts/monitor_regional_risks.js` — 224 LOC CLI
**Purpose:** On-demand regional CLI report.

**Findings:**
* Not exported — untestable, violates testability.
* Uses only `manha` sample `dayData.manha ? manha : dayData` — discards `tarde/noite` storm.
* `parseRadiusArg` reads `process.argv` globally — not injectable.
* No `logMonitorCycle` audit, unlike service.

### 2.8 `src/monitoring/monitor_service.js` — 531 LOC (scheduler + coordinator)
**Exports:** `parseCategoryTier()`, `parseMonitorConfig()`, `onHighRiskEventDetected()`, `createAlertDispatcher()`, `performRegionalRiskMonitoring()`, `startMonitoringService()`, `saveLastScanSnapshot()`, `getLastScanSnapshot()` (+ re-exports).

**Findings:**
* `createAlertDispatcher` deliveryFailed gating freezes `activeAlertKeys` on failure → spam loop; `dataComplete=false` also freezes → stale never cleared.
* `performRegionalRiskMonitoring` `missingForecasts = max(0, cities.length - regionalForecasts.length)` always 0 (length always equals input).
* `saveLastScanSnapshot` truncates 20 events without `truncated:true` flag.
* `updateConfig` reschedule only for interval, radius change waits interval.
* `process.on('SIGINT')` not `once` — leak if called twice in tests.

### 2.9 `src/monitoring/risk_analyzer.js` — 574 LOC (core business logic)
**Exports:** `SEVERITY_LEVELS`, `ALERT_CATEGORIES`, `getEventCategory()`, `normalizeSeverityTier()`, `parseWarningDate()`, `getRiskEventKey()`, `parseRadiusArg()`, `parseForecastDate()`, `analyzeForecastRisks()`, `evaluateHighRisksIn24hWindow()`, `aggregateRiskEvents()`.

**Findings:**
* `createSaoPauloDate` `year<100` edge, `parseWarningDate` offset regex matches `+` inside date.
* `parseRadiusArg` treats any positional as radius (`node script.js path/to/file` → 50).
* `analyzeForecastRisks` benign regex `/sol|.../` matches `sol` inside `isolado` → hides risk.
* `UNKNOWN=4` outranks RED intentional but `warningRank = SEVERITY_LEVELS[warningTier]||1` → `UNKNOWN` always ≥ `OFF` even when `inmetMinSeverity=OFF` (guarded by `if(inmetRank>0)`).
* `getEventCategory` order `rio` before `chuva` → `rio de chuva` → `rio` not `chuva`.
* `evaluateHighRisksIn24hWindow` period slicing off-by-1ms.

### 2.10 `src/bot/telegram_bot.js` — 1832 LOC (presentation, largest)
**Exports:** `CARD_HEADER/DIVIDER`, `INMET_SEVERITY_OPTIONS`, `DEFESA_CIVIL_SEVERITY_OPTIONS`, `CATEGORY_SEVERITY_OPTIONS`, `getTierBadge()`, `getTierShortBadge()`, `BOT_COMMANDS[6]`, `renderSeverityBadge()`, `buildInviteRequiredMessage()`, `buildRegularWelcomeMessage()`, class `WeatherTelegramBot` (30+ methods).

**Findings:**
* Monolith 1832 LOC, `registerHandlers()` 600 lines 40 `if(data===)` branches — Repeated Switches, not table-driven.
* `renderSeverityBadge` order `YELLOW` before `ORANGE` fragile; `HIGH`/`RED` both 🔴, `MODERATE` maps to YELLOW not ORANGE.
* `isAdmin` double DB read per message (performance).
* `tryConsumeInviteCode` duplicates normalization with `admin_store`.
* `buildInviteRequiredMessage` alias dead indirection.
* `updateConfig` local vs monitor diverge (two sources).
* `renderAdminsMenu` expiry race shows `0m 0s`.
* Telegram markdown not escaped for `details`.

### 2.11 `src/bot/telegram.js` — 313 LOC (grammY wrapper)
**Exports:** `InlineKeyboard`, `TELEGRAM_MAX_MESSAGE_LENGTH=4096`, `parseTelegramAdminChatIds()`, `parseTelegramConfig()`, `splitTelegramMessage()`, `TelegramBotClient` (isAdminChat, addAdminChatId, getAdminChatIds, onCommand/onText/onCallbackQuery/onError, sendToAdmins, setMyCommands, start/stop).

**Findings:**
* `parseTelegramConfig` now DB-only bootstrap (returns `adminChatIds:[]`), `parseTelegramAdminChatIds` still exported but unused for env.
* `splitTextByParagraphs` splits only `\n\n`, hard-split emoji via `Array.from` correct but `current` reset logic duplicate.
* `splitTelegramMessage` header estimation uses `chunks.length` both numerator+denominator — over-reserves.
* `onCallbackQuery` dual path `bot.callbackQuery` vs `bot.on` mis-registers when filter is string.
* `sendToAdmins` sequential, no 429 delay.

### 2.12 `src/weather_bot.js` — 77 LOC (composition)
**Exports:** `startWeatherBot()`.

**Findings:**
* Duplicate admin sync: `weather_bot.js:30` loop + `telegram_bot.js:256` `syncAdminsFromStore()` redundant.
* `bot.initCommands().catch(()=>{})` swallows error silently.

---

## 3. Tests & Migrations Map

### Tests (8 files, 112 tests, all pass `node --test`)

| Test file | Lines | Coverage | Gaps |
|---|---|---|---|
| `admin_store.test.js` | 539 | 15 suites: generate, normalize, persist, create/clear, consume single-use/case-insensitive, Telegram flow pastes, regular prompt, admin generate, last_scan, expiry, surrounding text, `t.me` link accept/reject, bootstrap first user | Missing `removePersistedAdminChatId`, `hashInviteCode`, `extractInviteCodeFromText` direct, `getActiveInvites`, `attempts` increment, concurrency, `code_hash` collision |
| `database_driver.test.js` | 235 | 15 features: connect/ping/insert/find/update/upsert/delete/where/transaction/raw/date | Missing `lt/lte/gte/like`, `exec`, file-path DB, `updateFields` subset, SQL injection, nested TX |
| `defesa_civil_client.test.js` | 292 | Constants, GraphQL non-null, thresholds Orange/Red, fusion, quotas, flood/alert cotas, Guaíba, unknown fallback, throwOnError | No success `getDefesaCivilTelemetry` mock, no `log:false`, no network throw, no boundary `20/30` mm, no `null` river |
| `inmet_client.test.js` | 78 | Constants, city list, emoji, surrounding 100/50, warnings shape, forecasts shape | **Live fetch without mock** — violates unit-only rule; missing `httpGet` error, `getCityForecast`, `getActiveRiskWarnings` filtering |
| `log_database.test.js` | 292 | Schema, extractEndpoint, logFetch success/failure, logAlert, logMonitorCycle, pagination, stats, settings | Missing `getRecentAlertLogs` filters, `getFetchStats` empty, `extractEndpoint` null, `closeDatabase` |
| `migrate.test.js` | 191 | splitSqlStatements, migrate apply/idempotency/custom dir/rollback | Not testing `/* */`, string `;`, Windows `\r\n`, non-numeric prefix, duplicate version, `005` boolean legacy, `007` delete |
| `monitor_service.test.js` | 660 | parseRadiusArg, analyzeForecastRisks 6 cases, parseMonitorConfig, unknown UNKNOWN, rings 6/20/31/38, getEventCategory 19 mappings, dynamic updateConfig, forecast window, dispatcher, category filtering, incomplete telemetry | Missing `performRegionalRiskMonitoring` 50/100km, Defesa `OFF`, `inmetMinSeverity OFF` with UNKNOWN, `saveLastScanSnapshot`, `setInterval` firing |
| `telegram.test.js` | 531 | parse admin deduplicate, parseConfig DB-only, split 4096+emoji, sendToAdmins, keyboards, formatHighRiskAlert, aggregate, UNKNOWN, regular vs admin restriction, delivery summary | Missing empty/exact 4096, partial failure, `isAdminChat` string/number, `buildRegularKeyboard`, `renderLastScanReport` direct, callback invalid value |

**Migration files (7):** `001` base tables +6 indexes, `002` seed `50/15/RED/ORANGE`, `003` seed `alert_cat_* YELLOW`, `004` `unknown_alert_sources`, `005` `1→YELLOW/0→OFF`, `006` `admin_users`+`admin_invites` + indexes, `007` `DELETE` legacy keys — all `CREATE IF NOT EXISTS` + `INSERT OR IGNORE` idempotent, `migrate.js:109` `withTransaction` atomic.

### Doc & Ops Map (10 files)

| File | Purpose | Stale/Mismatch (code vs doc) |
|---|---|---|
| `AGENTS.md:1` | Primary guide, 4 non-negotiable rules | Tree `AGENTS.md:55` omits `ALERT_METHODOLOGY.md`, `defesa_civil_client.js`, `admin_store.js`; roadmap `AGENTS.md:163` Defesa fusion `[x]` but listed as todo; `/inscrever` TODO vs actual invite-code flow |
| `GEMINI.md:1` | Duplicate of AGENTS for Gemini | Same stale tree/roadmap as AGENTS |
| `README.md:1` | Public quick-start | Tree `README.md:18` omits `ALERT_METHODOLOGY.md`; `README.md:27` risk_analyzer understated; now correctly `TELEGRAM_BOT_TOKEN` only + bootstrap note |
| `TODO.md:1` | 5-item Portuguese roadmap | 1-2 `[x]` done, 3-5 partially (open subscription vs invite-code, `/addadmin` vs invite link) |
| `package.json:1` | ESM, scripts, `grammy` single dep | No `engines` pin Node26, `Dockerfile:4` never copies `package-lock.json` so `npm ci` never runs |
| `Dockerfile:1` | 3 stages base/dev/prod | `COPY package.json` only, not `package-lock.json` → always `npm install`; dev vs prod identical except `NODE_ENV`; no `EXPOSE/HEALTHCHECK/USER` |
| `compose.yaml:1` | Prod daemon `app` | Service `app` vs `AGENTS.md:151` `weather-bot` log example fails |
| `compose.dev.yaml:1` | Dev live volume | `restart: unless-stopped` loops on syntax error; `command: npm start` vs `SKILL.md:35` `sleep infinity` docs diverge |
| `.env.example:1` | 8 vars | Now `TELEGRAM_BOT_TOKEN` only + `LOG_RETENTION_HOURS=168` `src/model/log_database.js:514`; missing `IBGE_API_URL`, `TELEGRAM_BOT_USERNAME`, `INMET_MIN_SEVERITY` fallback |
| `docs/ALERT_METHODOLOGY.md:1` | Canonical normative (570 lines) | Very high fidelity; missing `UNKNOWN:4` tier table `src/monitoring/risk_analyzer.js:19` + `LOG_RETENTION_HOURS` retention `src/model/log_database.js:534` not documented |
| `docs/DEFESA_CIVIL_RS_API_DOCUMENTATION.md:1` | GraphQL spec, 6 stations | Endpoint + `REGIONAL_STATIONS:27` + `TAGS_DATA_QUERY:35` match; WS `nowcasting` aspirational not implemented (poll only) |
| `docs/INMET_API_DOCUMENTATION.md:1` | Forecast/warnings/stations | `User-Agent` `src/clients/inmet_client.js:14` matches; `hoje/amanha` normalization `src/clients/inmet_client.js:188` correct |
| `docs/METEOROLOGICAL_RISKS_GUIDE.md:1` | Intro guide, 10 cities | **Stale** `LINE 32` fixed `INMET strictly RED` contradicts configurable `ALERT_METHODOLOGY.md:206` + `src/monitoring/risk_analyzer.js:348`; city list 10 vs actual 38 `src/clients/inmet_client.js:19` |
| `docs/TELEGRAM_BOT_SCOPE.md:1` | UI benchmarking, DB-only bootstrap | Now correct `DB-only bootstrap` `TELEGRAM_BOT_SCOPE.md:77`, `CARD_HEADER` `src/bot/telegram_bot.js:31`, `UNKNOWN` badge doc |
| Skills (6) | `inmet-weather-monitor`, `defesa-civil-rs-telemetry`, etc. | `inmet-weather-monitor/SKILL.md:88` thresholds `38°C/20%` diverge from `risk_analyzer.js:257` `40°C/12%`; `grammy-architecture.md:18` lists `/jacui//chatid` not in `BOT_COMMANDS:100`; command docs stale |

---

## 4. Critical Findings — Ordered by Severity

### HIGH (hurts after merge)

* **H1 `src/model/log_database.js:554` SQL injection via string interpolation** `DELETE ... '${cutoff}'` — cutoff is ISO but pattern violates param quoting; should use `?` placeholder via driver.
* **H2 `src/monitoring/monitor_service.js:196` `createAlertDispatcher` freeze on `deliveryFailed` or `!dataComplete`** — same alerts resent every cycle (spam) or stale never cleared.
* **H3 `src/clients/defesa_civil_client.js:221` river `0` → `null` coercion** — valid dry river `0` treated as missing, absolute flood check `src/clients/defesa_civil_client.js:280` skipped.
* **H4 `src/helpers/database_driver.js:51` global singleton `connected` ignores `path` change** — parallel `tests` using `:memory:` vs file can clobber; `migrate.js:60` forces `close` workaround.
* **H5 `src/bot/telegram_bot.js:1832` monolith `registerHandlers` 600 lines 40 branches** — Repeated Switches, not table-driven, hard to test.

### MEDIUM

* **M1 `src/inmet_client.test.js:55` live fetch without mock** — violates `AGENTS.md:33` unit-only, flaky offline.
* **M2 `src/model/admin_store.js:268` plaintext `code_plain` alongside hash** — DB leak = code leak.
* **M3 `src/monitoring/monitor_service.js:62` snapshot truncate 20 without `truncated:true` flag** — regular `Ver Últimos Alertas` hides events silently.
* **M4 `src/bot/telegram_bot.js:354` `isAdmin` double DB read per message** — performance, should cache `admin_users`.
* **M5 `src/model/log_database.js:434` `cleanupOldLogs` double-count `before-after`** — concurrent inserts between counts under-count deleted.
* **M6 `src/helpers/migrate.js:35` `splitSqlStatements` strips `--` inside strings, `split(';')` fails inside literals.**
* **M7 `docs/METEOROLOGICAL_RISKS_GUIDE.md:32` fixed RED policy contradicts configurable thresholds.**

### LOW / Nits

* `Dockerfile:3` never copies `package-lock.json` → always `npm install` not `ci`.
* `compose.yaml` service `app` vs `AGENTS.md:151` `weather-bot` log example.
* `.env.example` missing `TELEGRAM_BOT_USERNAME`, `IBGE_API_URL`.
* `ALERT_METHODOLOGY.md` missing `UNKNOWN` tier row.
* `telegram_bot.js:206` `buildInviteRequiredMessage` alias dead indirection.

---

## 5. Operational Gaps

1. **Dockerfile determinism** `Dockerfile:3` → `COPY package*.json ./`
2. **Service name mismatch** `compose.yaml:3` vs `AGENTS.md:151` → fix log example to `app`
3. **Healthcheck missing** — no `HEALTHCHECK` in `Dockerfile`, no `depends_on` in `compose.yaml`, `unless-stopped` will restart-crash-loop on missing token `src/weather_bot.js:21` throw.
4. **No `engines` pin** `package.json:7` despite `AGENTS.md:13` Node 26.
5. **Retention not in `ALERT_METHODOLOGY.md`** — `LOG_RETENTION_HOURS` `src/model/log_database.js:514` every scan `src/monitoring/monitor_service.js:361` not documented as normative.

---

*Evidence file saved, all modules checked. Runtime checks (Telegram visual, live INMET/Defesa) not verifiable statically are marked above as gaps, not failures.*


---

## 6. Addendum 2026-09-11 — Folder Restructure (project-template inspired)

The flat `src/*.js` layout was regrouped following the `project-template`
`api/` conventions (`model/`, `helpers/`, `templates/`, `scripts/`, grouped
tests). Basenames kept for history; only directories changed.

```
src/weather_bot.js            (unchanged entry point)
src/bot/telegram.js           (moved, unchanged)
src/bot/telegram_bot.js       (orchestrator; presentation + keyboards extracted)
src/bot/presentation.js       (NEW: CARD_*, *_OPTIONS, badges, BOT_COMMANDS, welcome)
src/bot/keyboards.js          (NEW: 13 build*Keyboard pure functions)
src/bot/email_templates.js    (moved, unchanged)
src/clients/inmet_client.js | defesa_civil_client.js
src/monitoring/risk_analyzer.js | monitor_service.js
src/model/log_database.js | admin_store.js
src/helpers/database_driver.js | migrate.js | email_client.js
scripts/monitor_regional_risks.js
tests/{bot,clients,monitoring,model,helpers}/*.test.js  (mirrors src/)
```

* `src/bot/telegram_bot.js` 2085 → ~1500 LOC; public `WeatherTelegramBot` API
  unchanged (H5 partially addressed; `registerHandlers` router still stateful).
* `src/helpers/migrate.js` `DEFAULT_MIGRATIONS_DIR` adjusted to `../../migrations`.
* `package.json` test glob is now `tests/**/*.test.js`; CLI scripts point at new paths.
* Test hermeticity hardened: all suites force `DB_PATH=':memory:'` so the
  developer's real `database/weather_logs.db` is never touched (previously
  `startMonitoringService`'s immediate cycle and `logFetch` wrote into it).
* 157/157 unit tests pass; real DB verified byte-identical after a full run.
