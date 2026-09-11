FROM node:26-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --omit=dev; fi

FROM base AS development
ENV NODE_ENV=development
COPY . .
CMD ["npm", "start"]

FROM base AS production
ENV NODE_ENV=production
COPY . .
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "import('./src/helpers/database_driver.js').then(m=>m.Sqlite.connect() && m.Sqlite.ping() && process.exit(0)).catch(()=>process.exit(1))" || exit 1
CMD ["npm", "start"]
