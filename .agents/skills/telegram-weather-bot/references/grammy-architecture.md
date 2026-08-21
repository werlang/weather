# grammY Telegram Bot Architecture & Implementation Reference

## 1. Module Responsibilities

| File | Primary Responsibility |
| :--- | :--- |
| `src/telegram.js` | Direct grammY wrapper. Parses `TELEGRAM_BOT_TOKEN` & `TELEGRAM_ADMIN_CHAT_ID`, provides `splitMessage(text, 4096)`, `sendToAdmins(text)`, `start({ onStart })`, and `stop(signal)`. |
| `src/telegram_bot.js` | High-level OOP bot layer (`WeatherTelegramBot`). Manages interactive menus, inline keyboards, visual gauges, card templates, command routes, and `sendHighRiskAlerts` / `createAlertCallback`. |
| `src/weather_bot.js` | Process composition entry point. Initializes `WeatherTelegramBot`, binds alert callback to `startMonitoringService`, and coordinates graceful process exit. |

---

## 2. Command Specifications & Access Control

```
Command   | Access Level       | Behavior
----------|--------------------|----------------------------------------------------
/start    | Admin Only         | Opens rich interactive dashboard with visual telemetry cards and inline action buttons.
/menu     | Admin Only         | Renders primary menu and dashboard overview.
/jacui    | Admin Only         | Displays real-time Defesa Civil RS river telemetry and rain gauges.
/inmet    | Admin Only         | Displays active official INMET warnings and severities.
/config   | Admin Only         | Interactive settings (interval, radius, independent institute thresholds).
/status   | Admin Only         | Reports operational health, monitoring interval, radius, and SQLite metrics.
/help     | Admin Only         | Lists available commands and operational guide.
/chatid   | Public             | Returns caller's numeric chat ID for allowlist configuration.
Fallback  | Admin Only         | Friendly guidance with main dashboard inline buttons.
```

---

## 3. Mocking & Unit Testing grammY

To test bot command responses and alert delivery without contacting the Telegram Bot API servers, use fake bot client objects:

```javascript
import { WeatherTelegramBot } from '../src/telegram_bot.js';

// In-memory test client implementing TelegramBotClient interface
const recordedMessages = [];
const fakeTelegram = {
  isAdminChat: id => id === 12345,
  commandHandlers: {},
  command(name, handler) {
    this.commandHandlers[name] = handler;
  },
  on(eventType, handler) {
    this.messageHandler = handler;
  },
  onCommand(name, handler) {
    this.commandHandlers[name] = handler;
  },
  onCallbackQuery(handler) {
    this.callbackHandler = handler;
  },
  onText(handler) {
    this.textHandler = handler;
  },
  onError(handler) {
    this.errorHandler = handler;
  },
  async sendToAdmins(message) {
    recordedMessages.push(message);
    return { sent: [{ chatId: '12345', chunks: 1 }], failed: [] };
  }
};

new WeatherTelegramBot({ telegram: fakeTelegram });
```
