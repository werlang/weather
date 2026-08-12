FROM node:26-alpine AS base
WORKDIR /app
COPY package.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --omit=dev; fi

FROM base AS development
ENV NODE_ENV=development
COPY . .
CMD ["npm", "start"]

FROM base AS production
ENV NODE_ENV=production
COPY . .
CMD ["npm", "start"]
