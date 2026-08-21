---
name: weather-test-delivery
description: Test-first delivery, TDD workflows, and unit test execution for the Charqueadas / RS Weather Monitoring project using Node 26 native test runner inside Docker containers. Make sure to use this skill whenever writing, running, or debugging unit tests, implementing weather monitoring features, bug fixes, or refactoring in this repository, mocking INMET, Defesa Civil RS, or Telegram APIs, or validating test coverage and code reliability before delivery.
---

# Weather Test Delivery Skill

This skill governs test-driven development (TDD), unit testing standards, and deterministic mocking patterns for the **Charqueadas - RS Weather & Meteorological Risk Monitoring** project.

---

## 1. Core Testing Principles & Stack

* **Test Framework:** Node.js 26 native test runner (`node:test`, `node:assert`, `node:assert/strict`).
* **Zero External Test Frameworks:** No Jest, Vitest, Mocha, or third-party assertion libraries. Keep the dependency footprint minimal (`package.json` only contains `grammy`).
* **Module System:** Native ESM (`"type": "module"` in `package.json`, explicit `.js` extensions in imports).
* **Strict Containerization:** Node.js and Python are not installed on the host machine. All tests MUST run inside Docker (`node:26-alpine`).
* **Unit Tests Only by Default:** AI tasks must execute only isolated unit tests. Integration tests with live networks, Playwright, or browser smoke tests are strictly out of scope unless explicitly requested by the user.

---

## 2. Containerized Test Execution Commands

Always execute tests using the official Node 26 Alpine Docker image mounted to the current workspace:

### Run All Unit Tests (Standard Suite)
```bash
docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test
```

### Run a Specific Test File
```bash
# INMET Client unit tests
docker run --rm -v $(pwd):/app -w /app node:26-alpine node --test tests/inmet_client.test.js

# 24h Risk Monitoring Service unit tests
docker run --rm -v $(pwd):/app -w /app node:26-alpine node --test tests/monitor_service.test.js

# Telegram wrapper & bot unit tests
docker run --rm -v $(pwd):/app -w /app node:26-alpine node --test tests/telegram.test.js
```

### Run Tests Matching a Name Pattern
```bash
docker run --rm -v $(pwd):/app -w /app node:26-alpine node --test --test-name-pattern="24-Hour" tests/monitor_service.test.js
```

---

## 3. TDD Workflow (Red-Green-Refactor)

Follow the strict three-phase loop for any behavior change or bug fix:

```
┌────────────────────────────────────────────────────────┐
│ 1. RED: Write failing unit test in tests/*.test.js      │
│    Run test in Docker -> Witness expected failure      │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 2. GREEN: Write minimal code in src/*.js               │
│    Run test in Docker -> Verify suite turns green      │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│ 3. REFACTOR & DOCUMENT:                                │
│    - Maintain KISS/YAGNI & Rule of Three               │
│    - Add/update strict JSDoc docstrings                │
│    - Re-run test in Docker -> Ensure zero regressions  │
└────────────────────────────────────────────────────────┘
```

### Phase A: Red
1. Identify the target behavior (e.g. new weather risk condition, alert formatting change, or Telegram command).
2. Create or extend a `describe` block in `tests/`.
3. Assert expected outputs or thrown exceptions.
4. Execute via Docker to confirm failure for the right reason.

### Phase B: Green
1. Implement the minimal logic in `src/`.
2. Avoid premature optimization or speculative features (YAGNI).
3. Execute the Docker test command until tests pass cleanly.

### Phase C: Refactor & Document
1. Simplify logic and eliminate duplication across modules if repeated 3+ times (Rule of Three).
2. Ensure touched functions have complete JSDoc annotations (`@param`, `@returns`, `@throws`).
3. Re-verify the suite in Docker.

---

## 4. Deterministic Mocking Patterns (No External Libraries)

To guarantee fast, hermetic, and offline unit tests, mock all external network boundaries without external libraries like Sinon or Nock.

For detailed implementation recipes and boilerplate, consult **[Mocking Patterns Reference](references/mocking-patterns.md)**:

* **INMET REST API (`httpGet` / `fetch`):** Monkey-patch `globalThis.fetch` using a `try ... finally` block to return predictable JSON payloads for weather forecasts and severe risk alerts (`/previsao/4305355`, `/avisos/ativos`).
* **Defesa Civil RS GraphQL API:** Mock `fetch` POST requests to `https://redehidrometeorologica.defesacivil.rs.gov.br/graphql` returning simulated station telemetry (`DCRS-00032` for Charqueadas).
* **Telegram Bot & grammY:** Use dependency injection via `botFactory` or `TelegramBotClient` options to supply a `createFakeBot()` test double capturing dispatched messages and command callbacks.
* **Deterministic Clocks:** Inject explicit `now` Date objects into evaluation functions (`evaluateHighRisksIn24hWindow({ ..., now: new Date('2026-08-20T12:00:00Z') })`) to avoid timezone or time-of-day test flakiness.

---

## 5. Done Criteria & Validation Checklist

A testing or implementation task is complete ONLY when:
- [ ] Every behavioral change is backed by an automated unit test in `tests/`.
- [ ] Tests run successfully inside the Docker container: `docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test`.
- [ ] Test execution is 100% deterministic (no live network calls to INMET, Defesa Civil, or Telegram).
- [ ] Touched code includes comprehensive JSDoc docstrings and high-signal inline comments.
- [ ] Output verification report clearly identifies executed test suites, test counts, and duration.
