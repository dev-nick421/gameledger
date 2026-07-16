FROM node:22-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Persisted data lives under /app/data and /app/storage (mount as volumes).
CMD ["node", "src/index.js"]
