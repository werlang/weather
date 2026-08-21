# grammY Telegram Bot Architecture & Implementation Reference

## 1. Module Responsibilities

| File | Primary Responsibility |
| :--- | :--- |
| `src/telegram.js` | Direct grammY wrapper. Parses `TELEGRAM_BOT_TOKEN` & `TELEGRAM_ADMIN_CHAT_ID`, provides `splitMessage(text, 4096)`, `sendToAdmins(text)`, `start({ onStart })`, and `stop(signal)`. |
| `src/telegram_bot.js` | High-level bot behavior. Implements `createWeatherTelegramBot` (registers `/start`, `/help`, `/status`, `/chatid` and fallback handler) and `formatWeatherAlertMessage(payload)` + `createTelegramAlertCallback`. |
| `src/weather_bot.js` | Process composition entry point. Initializes `TelegramBotClient`, attaches alert callback to `startMonitoringService`, and coordinates graceful process exit. |

---

## 2. Command Specifications & Access Control

```
Command   | Access Level       | Behavior
----------|--------------------|----------------------------------------------------
/start    | Public             | Explains service purpose and informs whether caller is an authorized administrator.
/help     | Public             | Lists available commands and authorization rules.
/chatid   | Public             | Returns caller's numeric chat ID for allowlist configuration.
/status   | Admin Only         | Reports operational health, monitoring interval, and radius.
Fallback  | Public             | Friendly guidance with /help recommendation.
```

---

## 3. Mocking & Unit Testing grammY

To test bot command responses and alert delivery without contacting the Telegram Bot API servers, use fake bot client objects:

```javascript
import { createWeatherTelegramBot } from '../src/telegram_bot.js';

// In-memory test client implementing TelegramBotClient interface
const recordedMessages = [];
const fakeTelegram = {
  adminChatIds: ['12345'],
  commandHandlers: {},
  command(name, handler) {
    this.commandHandlers[name] = handler;
  },
  on(eventType, handler) {
    this.messageHandler = handler;
  },
  async sendToAdmins(message) {
    recordedMessages.push(message);
    return [{ chatId: '12345', messageId: 100 }];
  }
};

createWeatherTelegramBot({ telegram: fakeTelegram });
```
