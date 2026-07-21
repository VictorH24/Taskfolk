FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    SHARED_DIR=/shared

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache sqlite
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY desktop/providers/openclaw.cjs ./desktop/providers/openclaw.cjs
COPY public ./public

RUN mkdir -p /shared \
    && chown -R node:node /app /shared

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
