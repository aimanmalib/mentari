# 0007. Web: Vite and React, live reads from public endpoints, labelled sample data before deployment

Date: 2026-11-22. Status: accepted.

## Context

The site has to show both ledgers and check one against the other in the visitor's browser. The contracts are not on
testnet yet when the site is built, and judges may open it at any time. Every number on the site must come from the
chain or be clearly marked as an example. The text must exist in English and Bahasa Melayu.

## Decision

- `web/` is a Vite and React single-page site in TypeScript. Routes are plain paths (`/`, `/how-it-works`); the server
  already answers unknown paths with `index.html`.
- EVM reads go straight to the public JSON-RPC endpoint in `config/app.json` with viem (the endpoint allows any
  origin). Native reads go through the server's read-only `/lcd` proxy. viem is loaded only in live mode.
- The badge "both ledgers agree" is computed in the browser: for the latest `web.agreeCheckLatest` retirements, read
  `retirement(n)` and then `receipt{id}`; the receipt must exist, come from the contract's Native address (the same 20
  bytes in bech32) and start with the note the contract writes for that retirement. A failed read shows "could not
  read the ledgers", never "disagree".
- The receipts book answers a missing id with HTTP 500 and "not found"; that is the only failure read as "no receipt".
- Live mode turns on when `contracts.mentari` is set. Before that, and with `VITE_MENTARI_DATA=sample`, the site runs
  the same checks over `web/fixtures/sample.json` and says on the page that the numbers are examples.
- Every visible string is in `web/locales/en.json` and `web/locales/ms.json`. The choice order is `?lang=`, the saved
  choice, the browser language, then the default from config.
- Systems to show come from `config/meter.json`; the page labels every meter as simulated.
- Fonts are self-hosted from npm packages (Bricolage Grotesque, Instrument Sans, IBM Plex Mono for addresses).

## Consequences

- No wallet or key is needed to read the site, and the page cannot claim agreement it did not check.
- The badge checks a recent window, not the whole history. The page says so in its limits.
- The sample data must stay shaped like the contract's views. A test compares the site's ABI with `Mentari.sol`.

## How to undo

Delete `web/` and the "web build" step in `scripts/gerbang-ujian.sh`; the server then answers 503 "site not built" for
pages and keeps serving `/lcd` and `/api/demo`.
