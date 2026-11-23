# 0022. Demo refusals answer 503, and live sends stay off until the demo account is ready

Date: 2026-11-23. Status: accepted. Changes decision 0006. Follows decision 0021.

## Context

After the first testnet deployment (decision 0021) the site went to live mode and the demo sender turned on. The demo
account has no EVM window and holds no certificates yet, so the chain refused the first failure case and the server
answered `502` with `{"reason":"send-failed"}`. The page showed "The demo server did not answer". Reading the public
URL showed why: Cloudflare, in front of the site, replaced the body of the `502` with `error code: 502` in plain text.
It does the same for `504`. The page lost the reason and, when there was one, the transaction hash.

## Decision

- A failed send and a timed-out send answer `503` instead of `502` and `504`. The body is unchanged. Cloudflare passes
  `503` through, as it already did for the switch and low-funds refusals.
- `demo.enabled` in `config/limits.json` is `false` until the demo account holds certificates and can send. The page
  then says "Live sends are switched off" instead of attempting a send that the chain refuses. Turning it back on is a
  config change and a redeploy, done with the testnet cases.

## Consequences

- The page can explain every refusal through Cloudflare, with the transaction hash kept.
- The `/lcd` proxy still answers `502` on an upstream failure. The page treats any non-JSON answer there as "the testnet
  did not answer", which is already what it says, so it stays.

## How to undo

Put `504` and `502` back for `timeout` and `send-failed` in `server/src/demo/api.ts` and its tests, and set
`demo.enabled` to `true`.
