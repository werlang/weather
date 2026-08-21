# Telegram Bot Capabilities and Scope

## Purpose

Telegram is the canonical operational interface for this weather-monitoring
service. The bot delivers high-risk meteorological alerts detected by the
existing regional monitor to an explicitly configured administrator.

The monitor remains responsible for obtaining INMET data and deciding whether
an event is high risk. The Telegram layer is responsible for authentication,
message formatting, delivery, and bot lifecycle.

## Library decision

The project uses [grammY](https://grammy.dev/) as the Telegram Bot API
framework. On 2026-08-13, the npm package page reported approximately 3.6
million weekly downloads for `grammy`, compared with approximately 332 thousand
for `telegraf`. grammY also provides a current JavaScript API for command
handlers, replies, long polling, and graceful shutdown.

The framework is isolated behind `src/telegram.js`. Application code should use
the project wrapper instead of importing grammY directly unless a future bot
feature requires an explicit extension of that boundary.

## Capabilities in scope

### Alert delivery

- Send every high-risk event produced by the 24-hour regional monitor to each
  configured administrator chat.
- Include the event type, severity, source, affected municipalities, time
  window, trigger reason, and details when available.
- Split long messages into Telegram-safe chunks without losing event order.
- Keep the existing console log path available through the direct monitor
  entry point; Telegram delivery failures are logged without stopping the
  monitoring loop.

### Administrator interaction

- `/start`: explain the bot and whether the current chat is authorized.
- `/help`: list the available commands and the authorization model.
- `/chatid`: return the current Telegram chat ID for verification or a future
  configuration change.
- `/status`: return a short status response to an authorized administrator.
- Reply to unsupported messages with a concise help message.

Only configured administrator chat IDs may receive alerts or use the protected
status command. The initial configuration supports one or more IDs through the
`TELEGRAM_ADMIN_CHAT_ID` environment variable, separated by commas.

## Registration and authorization

Registration is configuration-based, not self-service:

1. Create the bot with Telegram's BotFather and save its token as
   `TELEGRAM_BOT_TOKEN`.
2. Obtain the numeric ID of the intended private administrator chat through a
   trusted Telegram client or account-ID utility.
3. Set `TELEGRAM_ADMIN_CHAT_ID` to that ID before starting `npm start`.
4. Use `/chatid` after startup to verify the configured chat ID; changing the
   allowlist still requires an environment update and restart.

The bot never treats `/start`, `/chatid`, or an arbitrary incoming message as
an authorization request. This prevents an unknown Telegram user from granting
themselves alert access. The bot token and administrator IDs are configuration
secrets or access-control data and must not be committed.

## Runtime configuration

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Yes for the bot entry point | — | Token issued by BotFather. |
| `TELEGRAM_ADMIN_CHAT_ID` | Yes for the bot entry point | — | One or more allow-listed chat IDs, comma-separated. |
| `RADIUS_KM` | No | `50` | Regional monitoring radius. |
| `MONITOR_INTERVAL_MINUTES` | No | `15` | Time between monitoring cycles. |

The bot uses long polling in this increment. A missing Telegram configuration
is a startup error for `npm start`; the direct monitor entry point remains
available for console-only diagnostics and tests.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/telegram.js` | Wrap grammY, parse configuration, enforce the admin allowlist for outbound delivery, and expose lifecycle/message methods. |
| `src/telegram_bot.js` | Register commands, authorize incoming updates, format risk events, and connect the wrapper to the monitor callback. |
| `src/weather_bot.js` | Compose the bot and monitor processes, start them, and coordinate graceful shutdown. |
| `src/monitor_service.js` | Fetch regional data, evaluate high-risk events, and invoke the supplied alert callback. |

## Explicit non-goals

This increment does not include:

- self-service admin enrollment or persistent user records;
- database-backed subscriptions, acknowledgements, delivery history, or
  deduplication across process restarts;
- Telegram groups, channels, inline mode, webhooks, or interactive menus;
- forecast lookup commands, configuration changes, or administrative controls
  from Telegram;
- replacement of INMET/Defesa Civil data collection or risk-analysis rules;
- guaranteed delivery when Telegram or the network is unavailable.

Future features must preserve the separation between risk analysis and
notification delivery and must document any new authorization or persistence
model before implementation.
