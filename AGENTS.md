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
  docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js 50
  ```

### 2. Unit Tests Only by Default
* Automated AI verification cycles must execute **unit tests only** (`node --test tests/*.test.js`).
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
* The background monitoring loop (`src/monitor_service.js`) and Telegram alert dispatcher (`src/telegram_bot.js`) must be resilient. External network glitches, API timeouts, or Telegram delivery failures must be caught, logged, and contained without terminating the long-running process.

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
│   └── TELEGRAM_BOT_SCOPE.md         # Telegram bot capabilities, security & non-goals
├── database/
│   ├── driver.js                     # Generic SQLite query-builder & CRUD driver (adapted from node-aec)
│   ├── index.js                      # Database module public exports
│   └── log_database.js               # Native Node 26 SQLite log database & telemetry analytics
├── src/
│   ├── inmet_client.js               # INMET & IBGE HTTP client (native fetch)
│   ├── risk_analyzer.js              # Business logic: risk parsing, 24h window evaluation
│   ├── monitor_service.js            # 24/7 background scheduler and risk coordinator
│   ├── telegram.js                   # grammY wrapper, allowlist auth, splitMessage (<4096)
│   ├── telegram_bot.js               # Bot command handlers, alert layout formatter
│   ├── weather_bot.js                # Process composition entry point & signal handling
│   └── monitor_regional_risks.js     # On-demand CLI regional report generator
├── tests/
│   ├── database_driver.test.js       # Unit tests for SQLite query-builder & CRUD driver
│   ├── inmet_client.test.js          # Unit tests for INMET client & regional rings
│   ├── log_database.test.js          # Unit tests for SQLite log database
│   ├── monitor_service.test.js       # Unit tests for risk analyzer & 24h window logic
│   └── telegram.test.js              # Unit tests for grammY wrapper & command handling
├── Dockerfile                        # Multi-stage Docker build (base, dev, prod)
├── compose.yaml                      # Production Docker Compose specification
├── compose.dev.yaml                  # Development Compose specification (live volume mount)
├── package.json                      # Scripts & single production dependency (grammy)
├── TODO.md                           # Active feature roadmap
└── README.md                         # Public repository documentation
```

### Module Responsibilities & Separation of Concerns

| Module | Allowed Responsibilities | Forbidden Responsibilities |
| :--- | :--- | :--- |
| `src/inmet_client.js` | Fetching INMET forecasts, active warnings, station lists; regional distance calculations. | Telegram messaging, risk analysis, scheduling. |
| `database/log_database.js` | SQLite persistence for API fetch performance, response times, status codes, telemetry logs. | Direct external network I/O, Telegram alert dispatch. |
| `src/risk_analyzer.js` | Parsing forecast parameters, classifying risk types/severities, 24h window matching. | Network I/O, Telegram delivery, formatting CLI UI. |
| `src/monitor_service.js` | Managing `setInterval` timer, coordinating fetch & analysis, calling alert callback. | Direct Telegram API calls, command handling. |
| `src/telegram.js` | grammY client lifecycle, allowlist parsing, `splitMessage` (<4096), `sendToAdmins`. | Domain weather parsing, risk algorithms. |
| `src/telegram_bot.js` | Registering `/start`, `/help`, `/status`, `/chatid`, formatting plain-text alert templates. | Socket handling, low-level grammY polling. |
| `src/weather_bot.js` | Composing Telegram bot and monitor service, handling `SIGINT`/`SIGTERM` graceful stop. | Domain logic, low-level HTTP requests. |


---

## 🧰 Available Agent Skills Index

When working on specialized tasks in this repository, leverage the project's hand-crafted skills in `.agents/skills/`:

| Skill Name | Trigger Keywords / Purpose | Primary Location |
| :--- | :--- | :--- |
| **`inmet-weather-monitor`** | INMET API, 5-day forecasts, active warnings, IBGE `4305355`, regional rings, 24h risk engine. | [`.agents/skills/inmet-weather-monitor/SKILL.md`](.agents/skills/inmet-weather-monitor/SKILL.md) |
| **`defesa-civil-rs-telemetry`** | Defesa Civil RS, GraphQL, WebSocket, station `DCRS-00032`, river levels (`rio_nivel`), rain spikes. | [`.agents/skills/defesa-civil-rs-telemetry/SKILL.md`](.agents/skills/defesa-civil-rs-telemetry/SKILL.md) |
| **`telegram-weather-bot`** | Telegram bot, grammY, message chunking, admin allowlist, alert notifications, commands. | [`.agents/skills/telegram-weather-bot/SKILL.md`](.agents/skills/telegram-weather-bot/SKILL.md) |
| **`weather-test-delivery`** | Writing/running unit tests, Node 26 test runner, Docker test execution, TDD, native mocking. | [`.agents/skills/weather-test-delivery/SKILL.md`](.agents/skills/weather-test-delivery/SKILL.md) |
| **`weather-code-quality-and-ops`**| Docker Compose, multi-stage builds, CLI execution, ESM standards, JSDoc, KISS/YAGNI. | [`.agents/skills/weather-code-quality-and-ops/SKILL.md`](.agents/skills/weather-code-quality-and-ops/SKILL.md) |

---

## 🚀 Common Commands & Operations (Cheat Sheet)

All commands are run using Docker:

```bash
# 1. Run full unit test suite (fast, ~1s)
docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test

# 2. Run a specific unit test file
docker run --rm -v $(pwd):/app -w /app node:26-alpine node --test tests/telegram.test.js

# 3. Run on-demand regional risk CLI report (default 50km radius)
docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js

# 4. Run on-demand regional risk CLI report (custom 100km radius)
docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js 100

# 5. Build and run production service via Docker Compose
docker compose up --build -d

# 6. View live production logs
docker compose logs -f weather-bot

# 7. Start development stack with live volume mounts
docker compose -f compose.dev.yaml up --build
```

---

## 🎯 Active Roadmap & Planned Features (from `TODO.md`)

When implementing new roadmap features, preserve the architecture:

1. **Defesa Civil RS Telemetry Fusion:**
   - Integrate station `DCRS-00032` (Charqueadas) river level and sub-hourly precipitation telemetry into `src/risk_analyzer.js` as a secondary ground-truth verification stream.
2. **Self-Service Alert Subscriptions:**
   - Add `/inscrever` and `/sair` commands in `src/telegram_bot.js`.
   - Maintain a separate subscriber store so citizens can receive alerts without acquiring administrator privileges.
3. **Interactive Telegram Admin Management:**
   - Add `/addadmin`, `/deladmin`, and `/listadmins` commands accessible only to verified administrators.
