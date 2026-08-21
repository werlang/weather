# Docker Runbooks & Container Operations

This guide provides operational runbooks for developing, running, testing, and managing containers in the Charqueadas Weather Monitoring project.

---

## 1. Quick Reference Commands

| Task | Command |
| :--- | :--- |
| **Run Unit Tests** | `docker run --rm -v $(pwd):/app -w /app node:26-alpine npm test` |
| **Regional CLI Report (50km)** | `docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js` |
| **Regional CLI Report (100km)** | `docker run --rm -v $(pwd):/app -w /app node:26-alpine node src/monitor_regional_risks.js 100` |
| **Console Monitor Daemon** | `docker run --rm -v $(pwd):/app -w /app node:26-alpine npm run monitor:console` |
| **Production Daemon (Start)** | `docker compose up -d --build` |
| **Production Daemon (Logs)** | `docker compose logs -f app` |
| **Production Daemon (Stop)** | `docker compose down` |
| **Development Stack (Start)** | `docker compose -f compose.dev.yaml up -d --build` |
| **Development Stack (Exec)** | `docker compose -f compose.dev.yaml exec app node src/monitor_regional_risks.js 75` |

---

## 2. Multi-Stage Dockerfile Architecture

The `Dockerfile` contains three distinct stages:

```dockerfile
# 1. Base Stage: node:26-alpine with dependencies
FROM node:26-alpine AS base
WORKDIR /app
COPY package.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --omit=dev; fi

# 2. Development Stage: live sync & development environment
FROM base AS development
ENV NODE_ENV=development
COPY . .
CMD ["npm", "start"]

# 3. Production Stage: optimized runtime image
FROM base AS production
ENV NODE_ENV=production
COPY . .
CMD ["npm", "start"]
```

---

## 3. Environment Configuration (`.env`)

Always copy `.env.example` to `.env` before running production compose:

```bash
cp .env.example .env
```

Key environment variables supported:
* `TELEGRAM_BOT_TOKEN`: The bot authentication token from BotFather (required for `npm start`).
* `TELEGRAM_ADMIN_CHAT_ID`: Comma-separated list of numerical Telegram chat IDs authorized to receive alerts and send commands.
* `MONITOR_INTERVAL_MINUTES`: Evaluation interval in minutes (default: `15`).
* `RADIUS_KM`: Regional monitoring radius around Charqueadas in kilometers (default: `50`).
* `CHARQUEADAS_IBGE_CODE`: IBGE geocode (default: `4305355`).
* `INMET_PREVMET_URL`: INMET base forecast URL (default: `https://apiprevmet3.inmet.gov.br`).

---

## 4. Operational Troubleshooting

### Problem 1: External API Connection Timeout / 503 Service Unavailable
* **Symptom:** Logs show `HTTP error 503 when fetching https://apiprevmet3.inmet.gov.br/...`
* **Resolution:** INMET servers occasionally experience overload during heavy weather events. The application handles this gracefully by logging a warning and returning empty records for that poll cycle. Verify network connectivity using:
  ```bash
  docker run --rm node:26-alpine wget -qO- https://apiprevmet3.inmet.gov.br/avisos/ativos | head -c 100
  ```

### Problem 2: Telegram Bot Unauthorized / Token Error
* **Symptom:** Daemon exits with `Error: Missing required Telegram environment variables: TELEGRAM_BOT_TOKEN`.
* **Resolution:** Ensure `.env` exists and contains valid credentials. If running standalone via `docker run`, pass environment variables explicitly:
  ```bash
  docker run --rm --env-file .env -v $(pwd):/app -w /app node:26-alpine npm start
  ```

### Problem 3: Out of Memory or Stale Container Caches
* **Resolution:** Clean docker build caches:
  ```bash
  docker compose down --volumes --remove-orphans
  docker compose build --no-cache
  ```
