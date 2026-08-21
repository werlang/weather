---
name: telegram-weather-bot
description: Comprehensive architecture, operational workflows, and implementation standards for the grammY-based Telegram bot interface in the weather monitoring service. Use this skill whenever working on Telegram bot lifecycle, alert formatting and chunking (<4096 chars), administrator allowlists, non-blocking monitor callbacks, command handlers (/start, /help, /chatid, /status), self-service alert subscriptions, or administrative user management in this project.
---

# Telegram Weather Bot Skill

This skill guides the implementation, lifecycle management, and architectural patterns of the **Telegram Bot operational interface** for the weather monitoring service, powered by **grammY**.

## Architecture & Module Boundaries

The Telegram integration follows a strict 3-tier module separation:

```
┌────────────────────────────────────────────────────────┐
│                  src/weather_bot.js                    │
│   (Process coordinator: bot + continuous monitor)     │
└────────────────────────┬───────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        ▼                                 ▼
┌────────────────────────┐       ┌────────────────────────┐
│  src/telegram_bot.js   │       │ src/monitor_service.js │
│ (Commands, formatting, │       │  (24h risk evaluation, │
│ alert delivery logic)  │       │   periodic scheduler)  │
└───────────┬────────────┘       └────────────────────────┘
            ▼
┌────────────────────────┐
│    src/telegram.js     │
│ (grammY client wrapper,│
│  allowlist, chunking)  │
└────────────────────────┘
```

For complete class definitions and implementation diagrams, see [grammY Architecture Reference](references/grammy-architecture.md).
For message formatting, layout templates, and character budget rules, see [Alert Templates & Formatting](references/alert-templates.md).

---

## Core Operational Patterns

### 1. Configuration & Administrator Allowlist
- **Environment Variables:**
  - `TELEGRAM_BOT_TOKEN`: Telegram bot token from BotFather.
  - `TELEGRAM_ADMIN_CHAT_ID`: Comma-separated list of allowed chat IDs (e.g. `123456789,987654321`).
- **Security Rule:** Outbound alert delivery and protected commands (`/status`) are strictly restricted to configured administrator IDs. An unauthorized user sending `/start` or `/status` is safely deflected with an informational message and never granted access.

### 2. Non-blocking Alert Dispatch (`createTelegramAlertCallback`)
The monitoring loop must never stall or crash due to Telegram network timeouts or rate limits:

```javascript
import { WeatherTelegramBot } from './telegram_bot.js';
import { TelegramBotClient } from './telegram.js';

const telegramClient = new TelegramBotClient({ token, adminChatIds, logger });
const bot = new WeatherTelegramBot({ telegram: telegramClient, logger });
const alertCallback = bot.createAlertCallback();

// Callback receives array of high-risk events detected in 24h window
await alertCallback([
  {
    type: 'Tempestade severa',
    severity: 'Grande Perigo',
    affectedCities: ['Charqueadas']
  }
]);
```

### 3. Telegram Message Length Guardrails (4096 Chars)
Telegram enforces a strict limit of 4096 UTF-8 characters per message. `TelegramBotClient` guarantees safe transmission via `splitMessage`:
- Messages exceeding 4096 characters are split cleanly without truncating risk fields.
- Chunk headers (e.g., `[Parte 1/2]`) maintain context and order across deliveries.

### 4. Process Lifecycle & Graceful Signal Handling
In `src/weather_bot.js`, process termination signals (`SIGINT`, `SIGTERM`) must coordinate shutdown:
- Stops the periodic monitoring timer (`monitor.stop()`).
- Calls `telegramClient.stop(signal)` to terminate long-polling cleanly before container shutdown.

---

## Roadmap Patterns (TODO.md Implementation)

When expanding the Telegram bot according to `TODO.md`:
1. **Self-Service Subscriptions (`/subscribe`, `/unsubscribe`):**
   - Maintain a distinct subscriber storage separate from administrator permissions.
   - Regular subscribers receive broadcast alerts but have zero access to administrative controls.
2. **Interactive Admin Management (`/addadmin`, `/removeadmin`):**
   - Provide command handlers accessible only to existing verified administrators.
   - Preserve authorization state with atomic file or state synchronization.
