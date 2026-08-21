# Telegram Bot Capabilities, UI/UX Design System & Scope

## 1. Purpose & Overview

Telegram is the canonical operational interface for this weather-monitoring service for **Charqueadas - RS** (IBGE `4305355`) and surrounding municipalities (25–100 km radius). The bot combines 24/7 continuous risk monitoring with an interactive, high-contrast dashboard for administrators.

The monitor service (`src/monitor_service.js`) fetches meteorological data from INMET and real-time telemetry from Defesa Civil RS, evaluating severe weather risks in 24-hour windows. The Telegram bot presentation layer (`src/telegram_bot.js` & `src/telegram.js`) handles user interactions, runtime settings, visual cards, alert formatting, and delivery.

---

## 2. Industry UI/UX Benchmarking: Top Players in the Telegram Bot Scene

To deliver a top-tier user experience, this bot incorporates design patterns and interaction paradigms from the industry's leading Telegram bots:

| Bot Category | Reference Players | UI/UX Innovations & Patterns Adopted |
| :--- | :--- | :--- |
| **System & Administration** | `@BotFather`, `@MissRose_bot`, `@Combot`, `@GroupHelpBot` | • **Breadcrumb Header Navigation** (`🏠 Início > ⚙️ Configurações > ⏱️ Intervalo`).<br>• **Stateful Inline Keyboards** with checkmark pills (`[ ✅ 15 min ]`, `[ ⏱️ 30 min ]`).<br>• **In-Place Updates** via `editMessageText` preventing chat clutter.<br>• **Toast Confirmations** via `answerCallbackQuery({ text: '...' })`. |
| **FinTech & High-Frequency Operations** | `@Wallet`, `@CryptoBot`, `@TrojanBot`, `@Unibot` | • **Structured Visual Cards** using Unicode box dividers (`━━━━━━━━━━━━━━━━━━━━━━━━━` & `─────────────────────────`).<br>• **High-Contrast Status Badges** (`🟢 NORMAL`, `🟡 MODERADO`, `🟠 SEVERO`, `🔴 CRÍTICO`).<br>• **Compact Action Trays** (2x2 / 2x3 balanced button grids). |
| **Weather & Environmental Telemetry** | `@WeathermanBot`, `@AirQualityBot`, Civil Protection Bots | • **High-Contrast Severity Color Coding** aligned with official INMET/Defesa Civil tiers.<br>• **Actionable Emergency Alert Headers** with clear municipal/school directives. |
| **Telegram Platform Standards** | Native Telegram API | • **Native Command Autocomplete** via `setMyCommands` for instant `/` command palette.<br>• **Character Budget Guardrails** strictly chunking under 4096 characters, preserving paragraph boundaries where possible and adding `[Parte X/Y]` pagination headers.<br>• **Severity-aware alert copy** that reserves suspension language for red events. |

---

## 3. UI/UX Design System & Visual Components

### A. High-Contrast Card Dividers
Messages use standardized Unicode borders to structure sections cleanly:
- `CARD_HEADER = '━━━━━━━━━━━━━━━━━━━━━━━━━'` — Used for outer message boundaries and category headers.
- `CARD_DIVIDER = '─────────────────────────'` — Used between list items, stations, and warnings.

### B. Severity Status Badges (`renderSeverityBadge`)
Official alerts and risk levels are mapped to standardized color badges:
- `🔴 GRANDE PERIGO (CRÍTICO)` — INMET Red / Defesa Civil Max Alert. Immediate class suspension advisory.
- `🟠 PERIGO (SEVERO)` — Defesa Civil Orange / Heavy storm / Flood risk.
- `🟡 PERIGO POTENCIAL (MODERADO)` — Yellow advisory.
- `🟢 NORMAL / MONITORAMENTO` — Nominal conditions.
- `❓ DESCONHECIDO — REVISAR` — Unrecognized color/severity vocabulary. UNKNOWN-tier events alert as red-equivalent, are flagged "NÃO CLASSIFICADO" for manual review, and their raw payload is recorded in the `unknown_alert_sources` SQLite table for future vocabulary hardening.

### C. Stateful Inline Keyboards & Radio Selectors
Settings menus show the active choice directly on the inline button with `✅` and provide direct one-tap switching:
```text
[ ⏱️ 5 min ]   [ ✅ 15 min ]
[ ⏱️ 30 min ]  [ ⏱️ 60 min ]
[ ⬅️ Voltar às Configurações ]
```
Provider threshold buttons in the settings menu also display the current color circle of each institute's minimum alert level:
```text
[ 🏛️ Limiar INMET: 🔴 Vermelho ]
[ 🛡️ Limiar Defesa Civil: 🟠 Laranja ]
```

### D. Alert Action Trays (`buildAlertActionKeyboard`)
Broadcast emergency alerts include quick jump action buttons attached directly to the alert message:
```text
[ 🚨 Alertas Ativos ]
[ 🏠 Abrir Painel Principal ]
```

---

## 4. Commands & Navigation Capabilities

### Available Bot Commands

| Command | Description | Access Level |
| :--- | :--- | :--- |
| `/start` or `/menu` | Opens the main interactive dashboard with button navigation. | Administrator |
| `/status` | Returns system operational health, SQLite fetch stats, and active parameters. | Administrator |
| `/alertas` | Displays active warnings and alerts from all sources (INMET + Defesa Civil RS). | Administrator |
| `/config` | Opens the interactive settings menu (interval, radius, alert categories, thresholds). | Administrator |
| `/help` | Shows operational help, command cheat sheet, and interactive shortcuts. | All (Public) |

---

## 5. Security & Administrator Allowlist

Registration is configuration-based:
1. Create the bot with Telegram's BotFather and obtain `TELEGRAM_BOT_TOKEN`.
2. Retrieve the authorized Telegram Chat ID (e.g., by messaging `@userinfobot` or checking the service logs on first contact).
3. Set `TELEGRAM_ADMIN_CHAT_ID` in `.env` (comma-separated for multiple admins).
4. Protected commands, settings modifications, and alert broadcasts are strictly restricted to allow-listed IDs.
5. Unauthorized users receive a polite access restriction card.

---

## 6. Runtime Configuration Parameters

| Variable | Required | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Token issued by BotFather. |
| `TELEGRAM_ADMIN_CHAT_ID` | Yes | — | Comma-separated allowlist of Telegram chat IDs. |
| `SQLITE_DB_PATH` | No | `weather_logs.db` | SQLite database path for fetch logs, metrics, and runtime settings. |

Runtime settings live in the SQLite `system_settings` table and are seeded with defaults on first start (migration 002): monitoring radius (`radius_km`, default `50` km) and cycle interval (`interval_minutes`, default `15` minutes) are configured exclusively through the database (bot `/config` or CLI), never through environment variables. `/config` changes persist across restarts.

---

## 7. Architecture & Separation of Concerns

| Module | Allowed Responsibilities |
| :--- | :--- |
| `src/telegram.js` | Wrap grammY `Bot`, manage lifecycle, parse admin IDs, split paginated messages (<4096 characters), register `setMyCommands`. |
| `src/telegram_bot.js` | UI rendering, Unicode cards, inline keyboards, callback query routing, alert formatting. |
| `src/weather_bot.js` | Process composition, signal handling (`SIGINT`/`SIGTERM`), coordinating bot + monitor startup. |
| `src/monitor_service.js` | Periodic scheduling, data fetching coordination, 24h high-risk evaluation, invoking alert callback. |
