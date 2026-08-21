# Architecture Rules & Code Quality Standards

This document defines architectural conventions, module boundaries, JSDoc docstring standards, and defensive resilience patterns for the project.

---

## 1. Module Boundaries & Responsibilities

The codebase in `src/` is cleanly divided into specialized layers:

```
src/
├── inmet_client.js          # Raw HTTP clients for INMET & IBGE + municipality catalog
├── risk_analyzer.js         # Pure risk heuristics, severity classification & CLI args
├── monitor_service.js       # Periodic polling loop & 24h risk evaluation orchestration
├── telegram.js              # Low-level grammY wrapper, auth check, msg chunking
├── telegram_bot.js          # Telegram bot handlers (/status, /start) & alert formatting
├── weather_bot.js           # Canonical entry point uniting monitor & Telegram daemon
└── monitor_regional_risks.js# CLI tool for on-demand console risk reporting
```

### Responsibility Rules:
1. **`inmet_client.js`**: Handles raw HTTP communication via `fetch`, URL formation, and data shaping. It must NOT contain Telegram or presentation formatting code.
2. **`risk_analyzer.js`**: Contains pure business logic (no network requests, no console logging). Easy to test deterministically with zero mocks.
3. **`monitor_service.js`**: Orchestrates periodic checks and invokes registered callback (`alertCallback`). It is agnostic to the delivery medium (can output to console, Telegram, email, etc.).
4. **`telegram.js` & `telegram_bot.js`**: Handle Telegram delivery, splitting messages at 4096 characters, validating chat authorization, and formatting messages with emojis.

---

## 2. JSDoc Documentation Standard

Every touched function, class constructor, exported method, and interface MUST include comprehensive JSDoc:

```javascript
/**
 * Evaluates high-risk weather situations overlapping the next 24 hours.
 *
 * @param {object} params - Input parameters for evaluation.
 * @param {Array<object>} params.regionalWarnings - Official active warnings from INMET.
 * @param {Array<object>} params.regionalForecasts - Forecast data per municipality.
 * @param {Date} [params.now=new Date()] - Reference timestamp for window calculations.
 * @returns {Array<object>} List of detected high-risk events.
 * @throws {TypeError} If regionalWarnings is not an array.
 */
export function evaluateHighRisksIn24hWindow({ regionalWarnings = [], regionalForecasts = [], now = new Date() } = {}) {
    // Implementation
}
```

### JSDoc Checklist:
- [ ] `@param` declarations specify accurate types (`string`, `number`, `Array<object>`, `Date`, `Function`).
- [ ] `@returns` defines return type and structure.
- [ ] Non-obvious invariants or side effects are documented.
- [ ] Stale JSDoc comments are updated whenever parameters or return structures change.

---

## 3. KISS, YAGNI & Rule of Three

1. **KISS (Keep It Simple, Stupid):**
   - Favor flat functions and pure modules over multi-layered inheritance or complex class hierarchies.
   - Avoid creating dependency injection frameworks or service locators; simple options objects (e.g. `{ logger, telegram, env }`) are sufficient.
2. **YAGNI (You Aren't Gonna Need It):**
   - Do not write code for speculative future weather providers or database backends until required.
   - Use built-in Node 26 capabilities (`node:test`, `fetch`, `AbortController`) rather than installing external dependencies.
3. **Rule of Three:**
   - If a logic snippet (e.g., date parsing or radius filtering) is used in two places, duplicating it locally is acceptable.
   - When the same pattern appears a 3rd time, extract a shared helper into `src/risk_analyzer.js` or `src/inmet_client.js` and add dedicated unit tests.

---

## 4. Defensive Error Containment in Long-Running Daemons

Long-running services must run unattended 24/7 without crashing:

```javascript
/**
 * Executes a single monitoring cycle with error containment.
 */
async function runMonitoringCycle({ logger = console, alertCallback }) {
    try {
        const cities = await getSurroundingCities(config.radiusKm);
        const { regionalWarnings } = await getRegionalRiskWarnings(cities).catch(err => {
            logger.warn?.(`⚠️ INMET warnings fetch failed: ${err.message}. Continuing with empty list.`);
            return { regionalWarnings: [], stateWarnings: [] };
        });

        const regionalForecasts = await getRegionalForecasts(cities).catch(err => {
            logger.warn?.(`⚠️ INMET forecasts fetch failed: ${err.message}. Continuing with empty list.`);
            return [];
        });

        const highRisks = evaluateHighRisksIn24hWindow({ regionalWarnings, regionalForecasts });
        if (highRisks.length > 0 && typeof alertCallback === 'function') {
            await alertCallback(highRisks);
        }
    } catch (error) {
        // Top-level containment catches unexpected runtime errors and prevents process crash
        logger.error?.(`❌ Unexpected error in monitoring tick: ${error.message}`, error.stack);
    }
}
```

---

## 5. Security & Credential Hygiene

- **No Secrets in Source Code or Logs:** Never hardcode tokens or passwords in `.js` files.
- **Environment Parsing:** Always parse configuration at application launch and validate format (e.g., `parseTelegramAdminChatIds` validates that IDs are valid integers/strings).
- **Sanitize Outputs:** When logging unexpected errors, redact sensitive headers, bot tokens, or webhook secrets.
