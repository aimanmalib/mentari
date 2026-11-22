# 0009. One container behind the reverse proxy, a read-only key folder, and a health watch

Date: 2026-11-22. Status: accepted.

## Context

PRD section 4.8 asks for a public demo at `https://mentari.sasateguh.com`: the Node server serves the built site,
proxies `/lcd` and sends the demo transactions. The host already runs Traefik on a shared Docker network. The demo
sender key must never enter the image or the repository. The contracts are not on the testnet yet, so the live chain
adapter for the demo sender does not exist; the site runs in sample mode and the demo falls back to recorded cases.

## Decision

- One image, two stages (`Dockerfile`, `node:22-alpine`). The build stage installs the web and server workspaces and
  runs `pnpm build`, which now builds the site and compiles the server (`server/tsconfig.build.json` to
  `server/dist`). The run stage holds `server/dist`, `web/dist` and `config/` only. The server needs nothing beyond
  Node, so the run stage has no `node_modules`. It runs as the `node` user with a read-only root filesystem.
- `deploy/deploy.sh` builds from a clean `git archive` of HEAD, refuses a dirty tree, a name that does not resolve, or
  less free disk than `MIN_FREE_GB`. It runs the container with Docker Compose, copies the Traefik route
  (`deploy/traefik.yaml.tmpl`: `compress` with a 256-byte floor, http to https) into the proxy, and keeps the
  previous image in a stopped container so `--rollback` works after the host prunes unused images. It retries the
  public check up to six times, ten seconds apart, before it reports a failure.
- The check after a deploy asks for `/healthz` 200 and for the page to arrive with `Cache-Control: no-transform` and
  `Content-Encoding` gzip or br.
- Host values (domain, network, proxy container, image builder, alert command, key folder) live in `deploy/hos.env`,
  which git ignores. `deploy/hos.env.example` lists them.
- `MENTARI_SECRETS_DIR` is created with mode 0700 and mounted read-only at `/run/mentari`. It stays empty until the
  contracts are deployed; the live adapter then reads the account 7 key file from there.
- `deploy/uptime.sh` runs from cron every 15 minutes until 22 December 2026. Two failed checks in a row send one
  warning; the first success after that sends one recovery line. `scripts/test/uptime.test.ts` covers both.

## Consequences

- The image does not change when the key arrives. Only a file in the mounted folder and the adapter code change.
- `pnpm build` takes a few seconds longer because it also compiles the server.
- The demo answers with recorded cases until the contracts and the key exist.

## How to undo

`bash deploy/deploy.sh --rollback` runs the previous image. To take the demo down: `docker compose -f
deploy/compose.yaml down`, remove `mentari.yaml` from the proxy's dynamic folder, and remove the cron line. Reverting
this commit removes the image recipe and the deploy files; the server still runs locally with `pnpm start`.
