# One container: the Node server (static site, /lcd proxy, demo sender) and the built web app.
# deploy/deploy.sh builds it from a clean `git archive` of HEAD. Stage 1 builds; stage 2 carries only what the
# server reads at run time. The server build bundles its packages (and the meter driver in scripts/src) into
# server/dist/main.js, so the run stage needs no node_modules.
FROM node:22-alpine AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/package.json scripts/
COPY server/package.json server/
COPY web/package.json web/
# scripts/ is installed too: the server bundle imports the meter chain driver from scripts/src.
RUN pnpm install --frozen-lockfile --filter @mentari/web... --filter @mentari/server... --filter @mentari/scripts --filter mentari
COPY . .
# The web build reads config/ and, once recorded, evidence/testnet.json (live mode shows the recorded cases).
RUN pnpm build

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
WORKDIR /app
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
# The server resolves config/ two levels above server/dist/.
COPY config ./config
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server/dist/main.js"]
