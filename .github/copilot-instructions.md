# GitHub Copilot & Coding Assistant Instructions — Weather Charqueadas

## Project Overview
Meteorological risk and weather forecast monitor for **Charqueadas - RS** (IBGE Code: `4305355`) and surrounding 38 regional municipalities (0–100km radius). Built with Node.js 26 (ESM, native test runner, native fetch), Docker Compose, and grammY Telegram bot.

---

## Critical Rules for Code Suggestions

1. **Host Environment:**
   - No Node.js or Python on the host machine.
   - Always suggest Docker container execution for commands and tests:
     `docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test`

2. **Testing Standards:**
   - Test framework: Node 26 native test runner (`node:test`) and assertions (`node:assert`).
   - Run unit tests only. No browser/Playwright/integration suites unless asked.
   - Use native test mocks (stubbing `globalThis.fetch` or injecting fake bot instances). No external mocking packages.

3. **Design & Conventions:**
   - Pure ECMAScript Modules (`import ... from './file.js'`).
   - Keep code simple, concise, and readable (KISS & YAGNI).
   - Provide complete JSDoc docstrings for all exported functions and classes.
   - Maintain module boundaries:
     - `src/inmet_client.js`: HTTP data retrieval (INMET/IBGE).
     - `src/risk_analyzer.js`: Pure risk classification and 24h evaluation logic.
     - `src/monitor_service.js`: Periodic timer and alert coordinator.
     - `src/telegram.js`: grammY client wrapper, allowlist, and chunking.
     - `src/telegram_bot.js`: Command handlers and alert formatting.
     - `src/weather_bot.js`: Main process composition and shutdown.
