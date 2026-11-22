# 0006. Demo sender: one route per case, limits in config, recorded case as fallback

Date: 2026-11-22. Status: accepted.

## Context

A judge with five minutes will not install a wallet. The site needs a "Retire now" button and three failure buttons
that send real testnet transactions from a server account (account 7), and show both ledgers before and after. The
account holds free test QOR, but a public button can still be drained or hammered, and the contracts are not deployed
yet when the HTTP side is written.

## Decision

- Routes: `POST /api/demo/retire` and `POST /api/demo/case/b|c|d`, plus `GET /api/demo/status` so the page can show what
  is left before a visitor clicks. Each route maps to one recorded case (A, B, C, D) in `evidence/testnet.json`.
- A send requires `content-type: application/json`. A cross-site page cannot set that without a CORS preflight, and the
  server never answers one, so other sites cannot spend the quota through a visitor's browser.
- Limits live in the `demo` block of `config/limits.json`: `maxConcurrent` (1), `perIpPerHour` (5, sliding hour),
  `perDay` (40, UTC calendar day), `minSenderBalanceQor`, `retireWh`, `timeoutMs`, and the `enabled` switch. The visitor
  address is the one from ADR 0005. Only sends that reach the chain count; a refusal or a low balance costs nothing.
- Every refusal (switch off, sender not configured, low funds, busy, limits, timeout, failed send) returns
  `{ ok: false, reason, fallback: { evidenceCase } }`. The page then shows that recorded case and re-checks it live.
  Error text from the chain is never echoed.
- A timeout answers the visitor but keeps the slot until the chain call ends, so a slow transaction cannot be
  overlapped by the next one.
- The chain side is the `DemoChain` interface. Tests use a fake with no key. Until the contracts are deployed the
  server uses `unconfiguredChain`, which makes every send fall back. The live adapter (viem, account 7 key read from a
  read-only file outside the image) is added with the testnet deployment.

## Consequences

- Counts are in memory, so a restart resets them. The balance floor still bounds the spend, and the daily total is
  small.
- Turning the demo off means editing `config/limits.json` and restarting the container.

## How to undo

Set `demo.enabled` to `false` (the site keeps working on recorded evidence), or remove `server/src/demo/` and the
`/api/demo` route in `server/src/app.ts`; `/api/*` then answers 404 as before.
