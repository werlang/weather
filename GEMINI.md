# Gemini & Antigravity Agent Rules — Weather Charqueadas

This file configures local rules, constraints, and operational context for Gemini and Antigravity agents in the **Weather & Meteorological Risk Monitoring — Charqueadas, RS** project.

---

## 🔒 Mandatory Project Rules

1. **No Host Node.js or Python Runtime:**
   - The user's host machine does not have Node.js or Python installed directly.
   - Execute all runtime commands, scripts, builds, and tests strictly inside Docker containers (`node:26-alpine`).
   - Canonical test command:
     ```bash
     docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test
     ```

2. **Validation Scope — Unit Tests Only:**
   - Execute **unit tests only** (`tests/*.test.js`) during automated development loops.
   - Do **not** execute Playwright, browser automation, or live integration tests unless explicitly requested by the user.

3. **Software Design Philosophy:**
   - **KISS (Keep It Simple, Stupid):** Prioritize clear, direct code. Extreme readability over cleverness.
   - **YAGNI (You Aren't Gonna Need It):** Implement only current requirements. Avoid premature abstractions, speculative interfaces, or single-use wrapper classes.
   - **Rule of Three:** Duplicate twice before abstracting on the third instance.

4. **Module Boundaries & Code Standards:**
   - Use native ECMAScript Modules (`import`/`export` with explicit `.js` extensions).
   - Document all exported functions and classes using JSDoc.
   - Maintain strict separation of concerns between data fetching (`inmet_client.js`), risk analysis (`risk_analyzer.js`), scheduling (`monitor_service.js`), and Telegram delivery (`telegram.js`, `telegram_bot.js`).

---

## 🧰 Specialized Project Skills

Refer to and trigger the hand-crafted skills in `.agents/skills/`:
- `inmet-weather-monitor`: Official INMET API, 5-day forecasts, severe alerts, 24h risk engine.
- `defesa-civil-rs-telemetry`: Defesa Civil RS GraphQL/WebSocket telemetry, station `DCRS-00032`, hydrometric river levels.
- `telegram-weather-bot`: grammY bot lifecycle, message chunking (<4096 chars), admin allowlist, broadcast delivery.
- `weather-test-delivery`: Dockerized unit test execution with Node.js 26 native test runner and native mocking.
- `weather-code-quality-and-ops`: Multi-stage Docker builds, Compose specifications, and ESM code quality.
