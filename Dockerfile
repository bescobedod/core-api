# Etapa 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN corepack enable && corepack pnpm install --prod --frozen-lockfile

COPY . .

# Etapa 2: Production
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

RUN apk add --no-cache dumb-init

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodeapp

COPY --from=builder --chown=nodeapp:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodeapp:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nodeapp:nodejs /app/index.js ./index.js
COPY --from=builder --chown=nodeapp:nodejs /app/configuration ./configuration
COPY --from=builder --chown=nodeapp:nodejs /app/controllers ./controllers
COPY --from=builder --chown=nodeapp:nodejs /app/integrations ./integrations
COPY --from=builder --chown=nodeapp:nodejs /app/middlewares ./middlewares
COPY --from=builder --chown=nodeapp:nodejs /app/models ./models
COPY --from=builder --chown=nodeapp:nodejs /app/routes ./routes
COPY --from=builder --chown=nodeapp:nodejs /app/services ./services

USER nodeapp

EXPOSE 5000

CMD ["dumb-init", "node", "index.js"]