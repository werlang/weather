# Agent Guide & Project Orientation — Weather Charqueadas

> **Welcome Agent!** This document is the primary developer and agent operating guide for the **Weather & Meteorological Risk Monitoring — Charqueadas, RS** repository. Always consult this document before planning, writing code, running tests, or modifying architecture in this codebase.

---

## 🧭 Project Identity & Overview

* **Repository:** `ifsul/weather`
* **Target Municipality:** Charqueadas - RS, Brazil (IBGE Geocode: `4305355`, Lat `-29.95`, Lon `-51.62`)
* **Regional Coverage:** Região Carbonífera / Baixo Jacuí / Porto Alegre Metropolitan Area (0–100km radius, 38 municipalities)
* **Core Function:** 24/7 continuous meteorological risk monitoring combining official **INMET** forecasts & severe alerts with **Defesa Civil RS** real-time hydrometeorological telemetry, dispatching actionable alerts to authorized administrators via **Telegram** (grammY framework).
* **Runtime & Stack:** Node.js 26 (Alpine Docker runtime, native ECMAScript Modules, native `node:test` test runner, native `fetch`), Docker Compose, zero third-party production dependencies except `grammy`.

---

## ⚠️ Non-Negotiable Project Rules & Constraints

Every AI agent working in this repository **must strictly follow these rules at all times**:

### 1. No Local Node.js or Python on Host Machine
* The developer does **not** have Node.js or Python installed directly on their host operating system.
* **Never attempt to run `npm`, `node`, or `python` directly on the host.**
* Always execute scripts, CLI tools, and tests inside the appropriate Docker container:
  ```bash
  # Run unit tests
  docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test

  # Run on-demand regional risk CLI tool
  docker run --rm -v $(pwd):/app -w /app node:26-alpine node scripts/monitor_regional_risks.js 50
  ```

### 2. Unit Tests Only by Default
* Automated AI verification cycles must execute **unit tests only** (`npm test`, i.e. `node --test "tests/**/*.test.js"`).
* **Never execute browser, Playwright, end-to-end, or live network integration suites** unless explicitly instructed by the user.
* All unit tests must use deterministic mocking (monkey-patching `globalThis.fetch`, injecting fake bot objects) without external mocking libraries.

### 3. KISS, YAGNI, and the Rule of Three
* **KISS (Keep It Simple, Stupid):** Extreme readability over cleverness. Choose the most straightforward, readable solution for every line of code.
* **YAGNI (You Aren't Gonna Need It):** Only code for current requirements, never speculative future needs. Avoid premature helper/wrapper classes, single-use classes, or speculative abstractions.
* **Rule of Three:** Copy-paste twice, abstract on the third time. If forcing DRY creates complex or confusing architectures, KISS wins — a little duplication is better than a bad abstraction.

### 4. Native ESM & JSDoc Standards
* Use native ECMAScript Modules (`import` / `export` with explicit `.js` extensions). Never use CommonJS `require()`.
* Every exported function, class, and method must have complete JSDoc docstrings with `@param` and `@returns` descriptions.

### 5. Error Containment in 24/7 Services
* The background monitoring loop (`src/monitoring/monitor_service.js`) and Telegram alert dispatcher (`src/bot/telegram_bot.js`) must be resilient. External network glitches, API timeouts, or Telegram delivery failures must be caught, logged, and contained without terminating the long-running process.

---

## 📁 Repository Architecture & Module Boundaries

```
ifsul/weather/
├── .agents/
│   └── skills/                       # Project-specific AI agent skills
│       ├── inmet-weather-monitor/    # INMET forecast, alerts & 24h risk evaluation
│       ├── defesa-civil-rs-telemetry/# Defesa Civil RS GraphQL telemetry & river monitoring
│       ├── telegram-weather-bot/     # grammY bot lifecycle, chunking & alert delivery
│       ├── weather-test-delivery/    # Dockerized Node 26 TDD & unit testing
│       └── weather-code-quality-and-ops/# Docker runbooks, ESM & KISS/YAGNI architecture
├── docs/
│   ├── INMET_API_DOCUMENTATION.md    # Complete technical reference for INMET endpoints
│   ├── DEFESA_CIVIL_RS_API_DOCUMENTATION.md # GraphQL/WebSocket schema for Defesa Civil RS
│   ├── METEOROLOGICAL_RISKS_GUIDE.md # Severity tiers, color codes, and filtering rules
│   ├── TELEGRAM_BOT_SCOPE.md         # Telegram bot capabilities, security & non-goals
│   └── ALERT_METHODOLOGY.md          # Canonical normative alert pipeline (must update with code)
├── database/                         # SQLite database storage (weather_logs.db)
├── migrations/                       # Versioned SQL migration scripts
│   ├── 001_initial_schema.sql        # Initial schema migration
│   ├── 002_seed_default_settings.sql # Default radius/interval/thresholds
│   ├── 003_seed_alert_categories.sql # Per-category tiers
│   ├── 004_unknown_alert_sources.sql # UNKNOWN tier registry
│   ├── 005_migrate_category_tiers.sql# Boolean → tier migration
│   ├── 006_admin_invites.sql         # Admin invites & users tables
│   ├── 007_cleanup_legacy_settings.sql# Legacy key cleanup
│   └── 008_sms_subscribers.sql       # SMS subscriber list (admin + citizen consent)
├── src/
│   ├── weather_bot.js                # Process composition entry point & signal handling
│   ├── bot/                          # Telegram interface (grammY)
│   │   ├── telegram.js               # grammY wrapper, DB allowlist auth, splitMessage (<4096)
│   │   ├── telegram_bot.js           # Bot orchestrator: commands, routing, renderers, dispatch channels, email + SMS flows
│   │   ├── presentation.js           # Pure UI atoms: cards, badges, options, commands, welcome, consent term copy, SMS test notice
│   │   ├── keyboards.js              # Pure keyboard builders (inline: menus, settings, dispatch channels, email, SMS; reply: consent share-contact)
│   │   ├── email_templates.js        # Alert MJML renderer + institution custom-message store (shared by SMS)
│   │   └── sms_templates.js          # Institution-message SMS body renderer (single line, segment pricing)
│   ├── clients/                      # Upstream data sources (network I/O lives here)
│   │   ├── inmet_client.js           # INMET & IBGE HTTP client (native fetch)
│   │   └── defesa_civil_client.js    # Defesa Civil RS GraphQL telemetry & river quotas
│   ├── monitoring/                   # Risk domain: pure analysis + 24/7 coordinator
│   │   ├── risk_analyzer.js          # Business logic: risk parsing, 24h window evaluation
│   │   └── monitor_service.js        # 24/7 background scheduler and risk coordinator + last_scan snapshot
│   ├── model/                        # SQLite persistence (no network I/O)
│   │   ├── log_database.js           # Native Node 26 SQLite log database & telemetry analytics + retention
│   │   ├── admin_store.js            # Admin allowlist & 5-min invite codes (admin_users/invites)
│   │   └── sms_subscriber_store.js   # SMS recipients (sms_subscribers, E.164) + per-chat withdrawal
│   └── helpers/                      # Cross-cutting infrastructure (no domain logic)
│       ├── database_driver.js        # Generic SQLite query-builder & CRUD driver (adapted from node-aec)
│       ├── migrate.js                # Versioned SQLite database migration runner
│       ├── email_client.js           # SMTP transport (Ethereal dev, SMTP prod, MJML compile)
│       └── sms_client.js             # SMS Dev gateway transport (key contract, E.164, credit math)
├── scripts/
│   └── monitor_regional_risks.js     # On-demand CLI regional report generator
├── tests/                            # Mirrors src/ groups (unit only, :memory: DB)
│   ├── bot/                          # telegram, email, SMS action/templates, consent flow tests
│   ├── clients/                      # INMET + Defesa Civil client tests
│   ├── monitoring/                   # Risk analyzer & 24h window logic tests
│   ├── model/                        # Log database, admin invite + SMS subscriber tests
│   └── helpers/                      # Driver, migrations, email + SMS transport tests
├── Dockerfile                        # Multi-stage Docker build (base, dev, prod)
├── compose.yaml                      # Production Docker Compose specification
├── compose.dev.yaml                  # Development Compose specification (live volume mount)
├── package.json                      # Scripts & production dependencies (grammy, nodemailer, mjml, html-to-text)
├── TODO.md                           # Active feature roadmap
└── README.md                         # Public repository documentation
```

### Module Responsibilities & Separation of Concerns

| Module | Allowed Responsibilities | Forbidden Responsibilities |
| :--- | :--- | :--- |
| `src/clients/inmet_client.js` | Fetching INMET forecasts, active warnings, station lists; regional distance calculations. | Telegram messaging, risk analysis, scheduling. |
| `src/clients/defesa_civil_client.js` | Fetching Defesa Civil RS GraphQL telemetry, river quotas, rain/wind thresholds. | Telegram messaging, scheduling, INMET parsing. |
| `src/model/admin_store.js` | Admin allowlist (`admin_users`) & invite codes (`admin_invites`, 5-min, hash), DB-only bootstrap. | Telegram delivery, forecast parsing, risk algorithms. |
| `src/model/sms_subscriber_store.js` | SMS recipients (`sms_subscribers`): E.164 normalization, idempotent add/remove, sorted dispatch list, per-chat withdrawal (`removeSmsSubscribersByChatId`). | SMS transport, Telegram delivery, forecast parsing. |
| `src/helpers/database_driver.js` | Generic SQLite query builder, CRUD helpers, transactions, and param quoting. | Application business logic, external network I/O. |
| `src/helpers/migrate.js` | Parsing SQL migration files, applying versioned scripts atomically, tracking `schema_migrations`. | Direct Telegram messaging, forecast polling. |
| `src/model/log_database.js` | SQLite persistence for API fetch performance, response times, status codes, telemetry logs, retention (`LOG_RETENTION_HOURS`), unknown sources. | Direct external network I/O, Telegram alert dispatch. |
| `src/monitoring/risk_analyzer.js` | Parsing forecast parameters, classifying risk types/severities, 24h window matching, `UNKNOWN` tier. | Network I/O, Telegram delivery, formatting CLI UI. |
| `src/monitoring/monitor_service.js` | Managing `setInterval` timer, coordinating fetch & analysis, calling alert callback, `last_scan_snapshot` caching. | Direct Telegram API calls, command handling. |
| `src/bot/telegram.js` | grammY client lifecycle, DB allowlist auth (`admin_users`), `splitMessage` (<4096), `sendToAdmins`. | Domain weather parsing, risk algorithms. |
| `src/bot/telegram_bot.js` | Orchestrator: `/start`, `/help`, `/status`, `/config`, invite/bootstrap, alert renderers, **🔔 Disparos** channel screen + toggles, email comunicado flow, callback routing. Delegates keyboards/presentation to sibling modules. | Socket handling, low-level grammY polling, upstream fetching. |
| `src/bot/presentation.js` | Pure UI atoms: card dividers, severity options/badges, `BOT_COMMANDS`, welcome copy, LGPD consent/withdrawal copy, SMS testing-mode notice. No dependencies. | Chat state, DB access, network I/O. |
| `src/bot/keyboards.js` | Pure keyboard builders (inline: main, settings, categories, alerts, dispatch channels, email, SMS; reply: consent share-contact). | Callback handling, message sending. |
| `src/bot/email_templates.js` | Alert MJML renderer + institution custom-message store (`system_settings`). | SMTP transport, Telegram delivery. |
| `src/bot/sms_templates.js` | Institution message as the SMS body: single-line normalization + segment pricing. No truncation, no emoji. | Gateway transport, recipient storage, Telegram delivery. |
| `src/helpers/email_client.js` | SMTP transport: Ethereal dev preview, production SMTP, strict MJML compile. | Template copy, recipient policy beyond `ALERT_EMAIL_TO`. |
| `src/helpers/sms_client.js` | SMS Dev gateway: env contract (`SMSDEV_KEY`/`SMS_TESTING`), E.164 normalization, segment/credit math, single-request batch send. | Recipient storage, message wording, Telegram delivery. |
| `scripts/monitor_regional_risks.js` | On-demand CLI regional report (report-only, no thresholds/delivery). | Alert dispatch, threshold logic. |
| `src/weather_bot.js` | Composing Telegram bot and monitor service, handling `SIGINT`/`SIGTERM` graceful stop. | Domain logic, low-level HTTP requests. |


---

## 🧰 Available Agent Skills Index

When working on specialized tasks in this repository, leverage the project's hand-crafted skills in `.agents/skills/`:

| Skill Name | Trigger Keywords / Purpose | Primary Location |
| :--- | :--- | :--- |
| **`inmet-weather-monitor`** | INMET API, 5-day forecasts, active warnings, IBGE `4305355`, regional rings, 24h risk engine. | [`.agents/skills/inmet-weather-monitor/SKILL.md`](.agents/skills/inmet-weather-monitor/SKILL.md) |
| **`defesa-civil-rs-telemetry`** | Defesa Civil RS, GraphQL, WebSocket, station `DCRS-00032`, river levels (`rio_nivel`), rain spikes. | [`.agents/skills/defesa-civil-rs-telemetry/SKILL.md`](.agents/skills/defesa-civil-rs-telemetry/SKILL.md) |
| **`telegram-weather-bot`** | Telegram bot, grammY, message chunking, admin allowlist, alert notifications, commands. | [`.agents/skills/telegram-weather-bot/SKILL.md`](.agents/skills/telegram-weather-bot/SKILL.md) |
| **`telegram-bot-ui-design`** | Telegram Bot UI/UX design system, Unicode card layouts, progress gauges, river trends, breadcrumbs, action trays, toast feedback. | [`.agents/skills/telegram-bot-ui-design/SKILL.md`](.agents/skills/telegram-bot-ui-design/SKILL.md) |
| **`weather-test-delivery`** | Writing/running unit tests, Node 26 test runner, Docker test execution, TDD, native mocking. | [`.agents/skills/weather-test-delivery/SKILL.md`](.agents/skills/weather-test-delivery/SKILL.md) |
| **`weather-code-quality-and-ops`**| Docker Compose, multi-stage builds, CLI execution, ESM standards, JSDoc, KISS/YAGNI. | [`.agents/skills/weather-code-quality-and-ops/SKILL.md`](.agents/skills/weather-code-quality-and-ops/SKILL.md) |


---

## 🚀 Common Commands & Operations (Cheat Sheet)

All commands are run using Docker:

```bash
# 1. Run full unit test suite (fast, ~1s)
docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test

# 2. Run a specific unit test file
docker run --rm -v $(pwd):/app -w /app node:26-alpine node --test tests/bot/telegram.test.js

# 3. Run on-demand regional risk CLI report (default 50km radius)
docker run --rm -v $(pwd):/app -w /app node:26-alpine node scripts/monitor_regional_risks.js

# 4. Run on-demand regional risk CLI report (custom 100km radius)
docker run --rm -v $(pwd):/app -w /app node:26-alpine node scripts/monitor_regional_risks.js 100

# 5. Build and run production service via Docker Compose
docker compose up --build -d

# 6. View live production logs
docker compose logs -f app

# 7. Start development stack with live volume mounts
docker compose -f compose.dev.yaml up --build
```

---

## 🎯 Active Roadmap & Planned Features (from `TODO.md`)

When implementing new roadmap features, preserve the architecture:

1. **Defesa Civil RS Telemetry Fusion:**
   - Integrate station `DCRS-00032` (Charqueadas) river level and sub-hourly precipitation telemetry into `src/monitoring/risk_analyzer.js` as a secondary ground-truth verification stream.
2. **Self-Service Alert Subscriptions:** ✅ **Implemented** (`/inscrever` deep link + command + regular-menu button, `/revogar` revocation).
   - `/inscrever` and `/revogar` live in `src/bot/telegram_bot.js` and are public — citizens subscribe without admin rights. The regular-user menu (`buildRegularKeyboard`) exposes the same term through `consent:start`.
   - There is **no separate store**: capture and revocation reuse `addSmsSubscriber`/`removeSmsSubscribersByChatId` on `sms_subscribers`.
   - The flow is two-step by Telegram platform constraint: official LGPD term with `[✅ Concordo]`, then the native `request_contact` reply button delivers the number; see `docs/ALERT_METHODOLOGY.md` §8.6 and `tests/bot/consent_flow.test.js`.
3. **Interactive Telegram Admin Management:**
   - Add `/addadmin`, `/deladmin`, and `/listadmins` commands accessible only to verified administrators.
