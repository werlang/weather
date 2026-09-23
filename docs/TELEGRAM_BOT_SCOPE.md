# Telegram Bot Capabilities, UI/UX Design System & Scope

## 1. Purpose & Overview

Telegram is the canonical operational interface for this weather-monitoring service for **Charqueadas - RS** (IBGE `4305355`) and surrounding municipalities (25–100 km radius). The bot combines 24/7 continuous risk monitoring with an interactive, high-contrast dashboard for administrators.

The monitor service (`src/monitoring/monitor_service.js`) fetches meteorological data from INMET and real-time telemetry from Defesa Civil RS, evaluating severe weather risks in 24-hour windows. The Telegram bot presentation layer (`src/bot/telegram_bot.js` & `src/bot/telegram.js`) handles user interactions, runtime settings, visual cards, alert formatting, and delivery.

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
- `❓ DESCONHECIDO — REVISAR` — Unrecognized color/severity vocabulary. UNKNOWN-tier events alert as red-equivalent, are flagged "NÃO CLASSIFICADO" for manual review, and their raw payload is recorded in the `unknown_alert_sources` SQLite table for future vocabulary hardening. Known no-worry forecast summaries (sol/céu/claro/nuvens) are discarded entirely — no alert, no record.

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
[ 🔔 Disparos ]
[ 🏠 Abrir Painel Principal ]
```
The same tray is reused by `buildActiveAlertsKeyboard`.

Both trays funnel dispatch through the single **🔔 Disparos**
(`action:dispatches`) entry, which opens the **alert dispatch menu**
(`buildAlertDispatchKeyboard`) — three actions, nothing else:

```text
[ 🚀 Enviar disparo ]
[ ✏️ Compor mensagem ] [ ⚙️ Ver configurações ]
[ ⬅️ Voltar aos alertas ]
```

* **🚀 Enviar disparo** (`action:dispatch_send`) fires **every armed mean in
  one action**: e-mail and then SMS. A disarmed mean is skipped and reported
  as such; with no mean armed the tap is refused with a toast.
  `renderDispatchResult` is the single receipt.
* **⚙️ Ver configurações** (`action:dispatch_config`) jumps to the dispatch
  **configuration** screen, which lives in **⚙️ Configurações → 🔔
  Disparos** — this is where the switches are, never inside the alert:
  `buildDispatchConfigKeyboard` + `renderDispatchConfig`, persisting as
  `system_settings.dispatch_email` and `.dispatch_sms` (`1` armed / `0`
  disarmed, **armed when the row is absent**).
* **✏️ Compor mensagem** (`action:message_compose`) opens the **shared**
  composer (`renderMessageCompose`), reachable from *both* the alert menu and
  the configuration screen; its back button returns to whichever opened it.
  Editing it via bot text (`action:message_edit`) updates the default stored
  in `system_settings.email_custom_message` and therefore **both** means at
  once — the e-mail quotes it and the SMS carries it as its whole body.

The automatic Telegram broadcast is **not** a switch. Every administrator must
receive it, so `createAlertCallback` is never gated and `dispatch:toggle:telegram`
is rejected outright. `EMAIL_TESTING` / `SMS_TESTING` are **not** switches
either: they are development guards that stop real delivery outside production.

Full pipeline: `ALERT_METHODOLOGY.md` §8.4 and §8.5.

---

## 4. Commands & Navigation Capabilities

### Available Bot Commands

| Command | Description | Access Level |
| :--- | :--- | :--- |
| `/start` or `/menu` | Opens the main interactive dashboard with button navigation. | Administrator |
| `/inscrever` (ou `/start inscrever`) | Opens the official consent term to subscribe this chat to SMS weather alerts. | All (Public) |
| `/revogar` | Withdraws that consent and deletes the numbers authorized by this chat. | All (Public) |
| `/status` | Returns system operational health, SQLite fetch stats, and active parameters. | Administrator |
| `/alertas` | Displays active warnings and alerts from all sources (INMET + Defesa Civil RS). | Administrator |
| `/config` | Opens the interactive settings menu (interval, radius, alert categories, thresholds). | Administrator |
| `/help` | Shows operational help, command cheat sheet, and interactive shortcuts. | All (Public) |

### Citizen SMS Subscription (Consent Capture)

Citizens enroll their own number through a two-step consent that never grants
administrator rights (full pipeline: `ALERT_METHODOLOGY.md` §8.6):

```text
/start inscrever │ 📱 Inscrever SMS  ──►  📜 TERMO DE CONSENTIMENTO (LGPD)
                       [ ✅ Concordo ]  [ ❌ Recusar ]
                            │
                            ▼ (only after ✅)
                       📱 COMPARTILHE O SEU NÚMERO
                       [ 📱 Compartilhar meu número ]  [ ❌ Cancelar ]
                            │
                            ▼
                       📜 INSCRIÇÃO CONFIRMADA — AUTORIZAÇÃO REGISTRADA
                       (+55 43 •••••-8888, revogável por /revogar)
```

- The keyword is matched **before** invite-code extraction — `inscrever`
  contains an 8-character A-Z0-9 run that would otherwise read as a code.
- The regular-user menu offers the same term through **📱 Inscrever SMS**
  (`consent:start`); `consent:start`, `consent:agree` and `consent:decline` are
  all routed **before** the admin gate, so a citizen can subscribe without ever
  holding (or seeking) admin rights.
- Telegram's `request_contact` button exists only on a reply keyboard, which is
  why the capture is a second step: the tap both delivers the number and is the
  recorded act of consent.
- A row reaches `sms_subscribers` only while an agreement from **the same
  chat** is pending and the card belongs to the sender (`contact.user_id`);
  foreign numbers, third-party cards, unsolicited contacts, and the cancel
  button store nothing, and the receipt masks the number.
- `/revogar` (and the cancel button) withdraw it: `removeSmsSubscribersByChatId`
  deletes only the rows that chat authorized.

---

## 5. Security & Administrator Allowlist (DB-only bootstrap)

Registration is DB-only (no env allowlist):
1. Create the bot with Telegram's BotFather and obtain `TELEGRAM_BOT_TOKEN` (only required env).
2. Deploy with empty `admin_users` table. First user to `/start` sees `🎉 BEM-VINDO — CONFIGURAÇÃO INICIAL` with `[✅ Aceitar]`/`[❌ Recusar]` — same accept/refuse flow as invite code. Accept persists `admin_users` (`added_by='bootstrap'`) and in-memory `TelegramBotClient` allowlist.
3. Further admins: existing admin Config → `👥 Convidar Administrador` generates `A-Z0-9×8` code (5-min, single-use, `admin_invites` table, `SHA256` hash) + shareable link `https://t.me/<bot>?start=CODE` → invitee `/start CODE` or pastes code → `[✅ Aceitar]`/`[❌ Recusar]` → `consumeInviteCode()` `withTransaction` promotes.
4. Protected commands, settings, live scans and broadcasts are restricted to DB allowlist (`admin_users` + in-memory). Regular users get friendly hello `buildRegularWelcomeMessage()` + `buildRegularKeyboard()` with `🚨 Ver Últimos Alertas` (read-only `getLastScanSnapshot()` from `system_settings:last_scan_snapshot`, no live `performRegionalRiskMonitoring()`) and `📱 Inscrever SMS` (public `consent:start`, opens the consent term without granting admin rights).
5. Unauthorized callbacks receive `Acesso restrito` toast + invite prompt.

---

## 6. Runtime Configuration Parameters

| Variable | Required | Default | Meaning |
| :--- | :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Yes | — | Token issued by BotFather. |
| `SQLITE_DB_PATH` | No | `weather_logs.db` | SQLite database path for fetch logs, metrics, runtime settings and `admin_users`/`admin_invites`. |
| `ALERT_EMAIL_TO` | No | placeholder | Recipient of the admin-triggered e-mail comunicado. |
| `EMAIL_TESTING` | No | — | Development guard: the e-mail never leaves the box (Ethereal preview). Must not be `true` in production. |
| `SMSDEV_KEY` | Prod: Yes | — | SMS Dev gateway key. |
| `SMSDEV_BASE_URL` | No | `https://api.smsdev.com.br/v1` | SMS Dev gateway base URL (https only). |
| `SMS_TESTING` | No | — | Development guard: nothing reaches the gateway; the triggering admin gets the subscriber-facing body as a flagged Telegram test message instead. Must not be `true` in production. |

Runtime settings live in the SQLite `system_settings` table and are seeded with defaults on first start (migration 002): monitoring radius (`radius_km`, default `50` km) and cycle interval (`interval_minutes`, default `15` minutes) are configured exclusively through the database (bot `/config` or CLI), never through environment variables. `/config` changes persist across restarts.

Dispatch channels are runtime settings as well: `dispatch_email` and `dispatch_sms` (`1` armed / `0` disarmed, **armed when the row is absent**), managed only from **⚙️ Configurações → 🔔 Disparos**. The automatic Telegram batch has **no switch**: every administrator must receive it, so `createAlertCallback` is never gated. The `*_TESTING` variables are *not* these switches — they only guarantee that a development environment never delivers for real.

---

## 7. Architecture & Separation of Concerns

| Module | Allowed Responsibilities |
| :--- | :--- |
| `src/bot/telegram.js` | Wrap grammY `Bot`, manage lifecycle, parse admin IDs, split paginated messages (<4096 characters), register `setMyCommands`. |
| `src/bot/telegram_bot.js` | UI rendering, Unicode cards, inline keyboards, callback query routing, alert formatting, dispatch configuration, shared composer, combined dispatch. |
| `src/weather_bot.js` | Process composition, signal handling (`SIGINT`/`SIGTERM`), coordinating bot + monitor startup. |
| `src/monitoring/monitor_service.js` | Periodic scheduling, data fetching coordination, 24h high-risk evaluation, invoking alert callback. |
