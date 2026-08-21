# Weather & Meteorological Risk Monitoring — Charqueadas, RS

A project and documentation suite for programmatically monitoring INMET weather forecasts, active meteorological risk situations, and station data for **Charqueadas - RS** (IBGE Code: `4305355`), structured using Node.js 26 and Docker Compose.

---

## 📁 Repository Structure

```
ifsul/weather/
├── README.md
├── package.json                      # Project manifest & NPM scripts
├── Dockerfile                        # Multi-stage Docker build (development & production)
├── compose.yaml                      # Production Compose specification
├── compose.dev.yaml                  # Development Compose specification (live volume mounts)
├── .env.example                      # Environment variables template
├── .env                              # Active environment configuration
├── docs/
│   ├── INMET_API_DOCUMENTATION.md          # Detailed API reference for INMET endpoints
│   ├── DEFESA_CIVIL_RS_API_DOCUMENTATION.md # Detailed GraphQL & WebSocket API reference for Defesa Civil RS
│   ├── METEOROLOGICAL_RISKS_GUIDE.md        # Guide on severe weather alert levels and filtering logic
│   └── TELEGRAM_BOT_SCOPE.md                # Bot capabilities, authorization, and non-goals
├── database/
│   └── weather_logs.db               # SQLite telemetry & audit log storage (git-ignored)
├── src/
│   ├── inmet_client.js               # Reusable Node 26 API client for INMET & IBGE
│   ├── database_driver.js            # Generic SQLite query-builder & CRUD driver (adapted from node-aec)
│   ├── log_database.js               # Native Node 26 SQLite log database & telemetry analytics
│   ├── risk_analyzer.js              # Shared risk analysis and CLI argument parsing utilities
│   ├── monitor_service.js            # Long-running 24h risk monitoring service
│   ├── telegram.js                   # grammY wrapper and administrator delivery client
│   ├── telegram_bot.js                # Telegram commands, authorization, and alert formatting
│   ├── weather_bot.js                # Canonical monitor + Telegram process entry point
│   └── monitor_regional_risks.js     # On-demand CLI regional risk report generator
└── tests/
    ├── database_driver.test.js       # Unit tests for SQLite query-builder & CRUD driver
    ├── inmet_client.test.js          # Unit tests for INMET client
    ├── log_database.test.js          # Unit tests for SQLite log database
    ├── monitor_service.test.js       # Unit tests for 24h window risk monitoring service
    └── telegram.test.js               # Unit tests for Telegram config, delivery, and commands
```

---

## 🚀 Quick Start (Running via Docker Compose & Node 26)

### 1. Run the canonical Telegram monitoring service (`npm start`)
```bash
# Copy the template and provide TELEGRAM_BOT_TOKEN plus TELEGRAM_ADMIN_CHAT_ID.
cp .env.example .env

# Starts long-running regional monitoring with Telegram alert delivery.
npm start
# or via Docker Compose
docker compose up --build
```

Configurable via `.env`:
- `TELEGRAM_BOT_TOKEN`: Token issued by Telegram's BotFather.
- `TELEGRAM_ADMIN_CHAT_ID`: One or more authorized chat IDs, comma-separated.
- `MONITOR_INTERVAL_MINUTES`: Interval between checks (default: `15` minutes)
- `RADIUS_KM`: Regional monitoring radius in kilometers (default: `50` km)
- `SQLITE_DB_PATH`: Path to SQLite logs database (default: `weather_logs.db`)

When a high-risk meteorological event is detected in the next 24h window, the
service logs it and sends the formatted alert to every configured administrator.
See [Telegram Bot Capabilities and Scope](docs/TELEGRAM_BOT_SCOPE.md) for the
registration flow and explicit non-goals.

For console-only diagnostics, use `npm run monitor:console`.

### 2. Run Development Stack
```bash
docker compose -f compose.dev.yaml up --build
```

### 3. Run Standalone Regional Risk CLI Report (Default 50km or Custom Distance)
```bash
# Default (50 km radius):
docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js

# Custom Distance (e.g. 100 km radius):
docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js 100
```

### 4. Inspect SQLite API Fetch Logs & Telemetry
```bash
# View recent fetch logs, response times, payload sizes, and aggregate metrics:
docker run --rm -v $(pwd):/app -w /app node:26-alpine npm run db:logs
```

### 5. Running Unit Tests
```bash
docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test
```

---

## 🌐 Quick API Reference

### 1. Forecast for Charqueadas - RS (INMET)
```http
GET https://apiprevmet3.inmet.gov.br/previsao/4305355
```

### 2. Defesa Civil RS Real-time Telemetry (Charqueadas Station `DCRS-00032`)
```http
POST https://redehidrometeorologica.defesacivil.rs.gov.br/graphql
```

### 3. Microregion Municipalities Endpoint (IBGE)
```http
GET https://servicodados.ibge.gov.br/api/v1/localidades/microrregioes/43025/municipios
```

### 4. Active Severe Risk Alerts (Brazil & Regional Filter - INMET)
```http
GET https://apiprevmet3.inmet.gov.br/avisos/ativos
```

### 5. Automatic Weather Stations List (INMET)
```http
GET https://apitempo.inmet.gov.br/estacoes/T
```

---

## 📚 Documentation & Agent Links
* [Master Agent Guide (AGENTS.md)](AGENTS.md)
* [Gemini / Antigravity Agent Rules (GEMINI.md)](GEMINI.md)
* [INMET API Technical Documentation](docs/INMET_API_DOCUMENTATION.md)
* [Defesa Civil RS Hydrometeorological Network API Documentation](docs/DEFESA_CIVIL_RS_API_DOCUMENTATION.md)
* [Meteorological Risk Situations Guide](docs/METEOROLOGICAL_RISKS_GUIDE.md)
* [Telegram Bot Capabilities and Scope](docs/TELEGRAM_BOT_SCOPE.md)

### 🧰 Specialized Agent Skills
* [`inmet-weather-monitor`](.agents/skills/inmet-weather-monitor/SKILL.md) — INMET API, 5-day forecasts, severe alerts & 24h risk engine
* [`defesa-civil-rs-telemetry`](.agents/skills/defesa-civil-rs-telemetry/SKILL.md) — Defesa Civil RS GraphQL telemetry & river monitoring
* [`telegram-weather-bot`](.agents/skills/telegram-weather-bot/SKILL.md) — grammY bot lifecycle, message chunking & admin delivery
* [`telegram-bot-ui-design`](.agents/skills/telegram-bot-ui-design/SKILL.md) — Telegram bot UI/UX design system, Unicode card layouts, progress gauges & action trays
* [`weather-test-delivery`](.agents/skills/weather-test-delivery/SKILL.md) — Localized TDD & unit testing (Node 26 + Docker)
* [`weather-code-quality-and-ops`](.agents/skills/weather-code-quality-and-ops/SKILL.md) — Docker Compose runbooks & KISS/YAGNI architecture

