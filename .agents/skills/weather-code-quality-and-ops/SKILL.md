---
name: weather-code-quality-and-ops
description: Operational runbooks, Docker multi-stage lifecycle, ESM code standards, JSDoc documentation, KISS/YAGNI enforcement, error resilience in 24/7 background monitors, and backend code review for the Charqueadas / RS Weather Monitoring project. Make sure to use this skill whenever building or running Docker/Compose environments, invoking containerized CLI commands, reviewing backend bugs, handling runtime failures in long-running services, writing ESM/JSDoc code, refactoring modules, or applying project lessons and git workflows.
---

# Weather Code Quality & Operations Skill

This skill governs containerized Docker operations, code architecture standards, error containment, and quality review practices for the **Charqueadas - RS Weather & Meteorological Risk Monitoring** repository.

---

## 1. Project Stack & Environment Reality

* **Runtime:** Node.js 26 (`node:26-alpine`).
* **Packaging & Module System:** Native ESM (`"type": "module"` in `package.json`, explicit `.js` extensions).
* **Host Isolation:** Node.js and Python are not installed on the host machine. Every operation (CLI execution, testing, daemon startup) MUST be executed through Docker containers.
* **Core Application Entry Point:** `src/weather_bot.js` (unifies 24/7 weather monitoring with Telegram bot notifications).

---

## 2. Docker Operations & Multi-Stage Lifecycle

The project uses a multi-stage `Dockerfile` targeting different operational modes:

```
┌────────────────────────────────────────────────────────┐
│ Stage 1: base (node:26-alpine)                         │
│ - WORKDIR /app, installs production dependencies       │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
┌──────────────────────────┐┌──────────────────────────┐
│ Stage 2: development     ││ Stage 3: production      │
│ - ENV NODE_ENV=dev       ││ - ENV NODE_ENV=prod      │
│ - compose.dev.yaml       ││ - compose.yaml           │
│ - Live volume mount      ││ - Immutable code copy    │
│ - sleep infinity         ││ - npm start (daemon)     │
└──────────────────────────┘└──────────────────────────┘
```

### Production vs Development Compose Configuration

| Environment | Compose File | Target Stage | Container Command | Primary Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Production** | `compose.yaml` | `production` | `npm start` (`node src/weather_bot.js`) | 24/7 unattended monitoring daemon with auto-restart (`unless-stopped`). |
| **Development** | `compose.dev.yaml` | `development` | `sleep infinity` (with volume `.:/app`) | Interactive CLI testing, ad-hoc commands, and live file editing without rebuilds. |

### Containerized CLI Execution Commands

For detailed recipes and troubleshooting, see **[Docker Runbooks Reference](references/docker-runbooks.md)**.

* **Run Standalone Regional Risk CLI Report (Default 50 km):**
  ```bash
  docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js
  ```
* **Run Regional Risk CLI Report with Custom Radius (e.g., 100 km):**
  ```bash
  docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js 100
  ```
* **Run Console-Only Diagnostic Monitor:**
  ```bash
  docker run --rm -v $(pwd):/app -w /app node:26-alpine npm run monitor:console
  ```
* **Start Production Daemon:**
  ```bash
  docker compose up -d --build
  ```

---

## 3. Architecture & Code Quality Standards

For module boundaries and design blueprints, see **[Architecture Rules Reference](references/architecture-rules.md)**.

### Native ESM & Syntax Rules
- Always use explicit `.js` extensions in imports: `import { httpGet } from './inmet_client.js';`.
- CLI script guard pattern: Use `if (import.meta.url === \`file://${process.argv[1]}\`)` to allow modules to be both imported in tests and executed standalone.

### Strict JSDoc Docstrings (Document Touched Code)
- Every touched function, class constructor, public method, and exported constant MUST have complete JSDoc annotations:
  - `@param {type} name - Description`
  - `@returns {type} Description`
  - `@throws {ErrorType} Description of conditions`
- Inline comments must focus strictly on **intent, assumptions, and non-obvious invariants** (avoid narrating trivial syntax).

### KISS, YAGNI & Rule of Three
- **KISS (Keep It Simple, Stupid):** Prefer flat, straightforward functional pipelines over deep object hierarchies.
- **YAGNI (You Aren't Gonna Need It):** Implement only the features and configurations needed right now. Do not add speculative caching layers or multi-provider abstractions without actual use.
- **Rule of Three:** Copy-paste logic twice for localized variants. On the 3rd repetition, extract a well-tested, shared utility function in `src/risk_analyzer.js` or `src/inmet_client.js`.

---

## 4. Defensive Error Containment in 24/7 Long-Running Services

The monitoring daemon (`src/weather_bot.js` / `src/monitor_service.js`) runs continuously and must never crash due to transient external failures:

1. **Contain External Network Failures:** INMET or Defesa Civil APIs frequently return HTTP 502/503, connection timeouts, or malformed JSON during severe storms.
   - Wrap remote calls in `try ... catch`.
   - Return safe fallback empty collections (`[]` or `{}`).
   - Log diagnostic errors with timestamp and source name, but keep the loop alive for the next tick.
2. **Never Log Sensitive Credentials:**
   - Redact `TELEGRAM_BOT_TOKEN` and chat IDs from exception traces.
   - Validate environment tokens at startup via `parseTelegramConfig()` before launching background loops.
3. **Graceful Shutdown & Signal Handling:**
   - Always register clean termination for `SIGINT` and `SIGTERM`.
   - Stop `setInterval` timers and invoke `telegramClient.stop(signal)` before process exit.

---

## 5. Backend Bug Review & Verification Checklist

When reviewing code, implementing refactors, or diagnosing defects:
1. **Identify Failure Modes:** Look for unhandled date formats (`DD/MM/YYYY` vs ISO), missing field fallbacks (`resumo`, `aviso_cor`), or unhandled Promise rejections.
2. **Write Failing Regression Test First:** Add a reproducible unit test in `tests/*.test.js` before applying fixes.
3. **Validate in Docker:** Run `docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test`.
4. **Atomic Git Commit:** Stage only affected files and commit with conventional commit format (`fix(inmet): ...`, `feat(telegram): ...`).
