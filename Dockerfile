FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8788
ENV MOIM_COORDINATOR_DATA_MODE=fixture
ENV MOIM_COORDINATOR_LIVE_TIMEOUT_MS=7000

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services

RUN npm install -g npm@11.6.2 \
  && npm ci --include=dev \
  && npm run build --workspace @playmcp/mcp-common \
  && npm run build --workspace @playmcp/moim-chongmu \
  && npm prune --omit=dev

EXPOSE 8788

CMD ["node", "services/moim-chongmu/dist/index.js"]
