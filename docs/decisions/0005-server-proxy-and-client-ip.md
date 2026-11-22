# 0005. One small Node server: static site, read-only `/lcd` proxy, client IP rules

Date: 2026-11-22. Status: accepted.

## Context

The site is static (Vite + React), but the Native REST API on the testnet sends no CORS headers, so a browser cannot read
receipts from it directly. The demo also needs a sender with rate limits, which needs a trustworthy visitor address. The
site will sit behind Cloudflare and traefik.

## Decision

- One process in `server/`, Node 22 built-in `http`, no framework and no runtime dependencies. It serves `web/dist`, answers
  `GET /healthz`, and proxies `GET /lcd/*`. The demo sender (`/api/demo/*`) comes later in the same process; until then
  `/api/*` is a 404.
- The proxy only reaches the origin of `network.rest` in `config/app.json`. It only forwards paths covered by
  `lcd.allowedPrefixes` in `config/limits.json`. A prefix ending in `/` covers a subtree; any other prefix is exact. The
  smart-query prefix is limited to the receipts book (`native.receiptsBook`, code 865) through a `{receiptsBook}` placeholder.
- The upstream URL is built by the URL parser. If parsing changed the path (dot segments, `%2e`) or the origin, the request is
  refused. Redirects are not followed. Only `GET` is allowed (405 otherwise). Replies under 500 are cached for
  `lcd.cacheSeconds`; replies larger than `lcd.maxBodyBytes` and network failures become 502 without internal detail.
- Visitor address: start from the TCP peer. If the peer is in `clientIp.trustedProxies` (traefik), take the last
  `x-forwarded-for` entry, which the proxy wrote. Only when that hop is in the Cloudflare ranges (`config/cloudflare-ips.json`,
  copied from cloudflare.com/ips) is `cf-connecting-ip` believed.
- HTML is sent with `Cache-Control: no-cache, no-transform` so the edge does not inject scripts. Files under `/assets/` are
  content-hashed by Vite and cached for a year. Compression is left to traefik.

## Consequences

- A direct client cannot pick its own rate-limit identity, and the proxy cannot be pointed at another host or another
  contract. Tests cover both (`server/test/`), and removing the prefix check, the origin check or the Cloudflare check turns
  them red (`docs/TESTING.md`).
- The Cloudflare list is a copy. If Cloudflare adds a range, visitors on it are limited by the edge address instead of their
  own until the file is updated. That is safe (stricter), not open.

## How to undo

Delete `server/` and the `lcd` and `clientIp` blocks of `config/limits.json`. The site can be served by any static host,
but the receipts lane then needs another way to read the Native REST API (for example a hosted proxy with the same
allowlist).
