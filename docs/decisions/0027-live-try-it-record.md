# 0027. Record the Try it buttons pressed on the public site, and check that record in `pnpm verify`

Date: 2026-11-23. Status: accepted. Follows decision 0024 (`pnpm verify`) and 0026 (Retire now from the Native lane).

## Context

The demo claim is that anyone can press the buttons on the public site and see atomicity: "Retire now" moves both
ledgers by one, and each of the three failure buttons moves neither. The recorded cases in `evidence/testnet.json`
were sent by scripts, not through the site. A judge should be able to see that the site itself did this, in more than
one browser and in both languages, and should be able to check it without trusting a screenshot.

## Decision

- I pressed the buttons on `https://mentari.sasateguh.com/try` with Playwright, one new browser context per press:
  WebKit with the iPhone 13 profile, WebKit at 320 px, and Chromium at 1440 px, in English and Malay. Each run
  waited for the server's answer and for the page to say "As expected", then checked for console errors and for a
  page wider than the screen.
- `evidence/live.json` keeps each run as it happened: button, browser, viewport, language, the transaction hash the
  server answered with, both counts before and after, the page's verdict, console errors and overflow. It also states
  one claim, `retireStreak`: how many times in a row Retire now succeeded.
- `scripts/src/live.ts` checks that file, and `pnpm verify` runs it when the file exists. It checks what each run
  showed, checks the streak claim, and reads every transaction back from public endpoints: a Retire now Cosmos
  transaction must be accepted at its block with one more receipt in the book there, and a failure button's EVM
  transaction must have reverted, sent to Mentari or AtomicityProbe.
- The browser script that pressed the buttons is not part of the repo. It spends real testnet transactions and is
  limited by the demo's per-visitor quota, so it is not something CI or a fresh clone should run.

## Measured on the testnet

Eight runs on 23 November, recorded in `evidence/live.json`. The three failure buttons first (WebKit iPhone 13 in
English and in Malay, Chromium at 1440 px in English): each EVM transaction reverted at `AtomicityProbe`, with EVM
retirements at 9 and Native receipts at 18 before and after. Then "Retire now" five times in a row, in WebKit iPhone 13
(English, Malay), Chromium 1440 px (English, Malay) and WebKit 320 px (English): Native receipts went from 18 to 23
and EVM retirements from 9 to 14, one each per press, at blocks 10623201 to 10623214. No run logged a console error
and no page was wider than the screen. `pnpm verify` then passed 65 of 65 checks, 22 of them from this record.

## Consequences

- `pnpm verify` prints more checks while `evidence/live.json` exists. The number in `evidence/verify.json` changes
  only when verify is run again with `--record`.
- The failure buttons need the demo sender's scoped EVM window. These runs were made while it was open.

## How to undo

Delete `evidence/live.json`: `pnpm verify` skips the live checks. To remove the code, delete `scripts/src/live.ts`,
its test, and the `live.json` block in `scripts/verify.ts`, and drop `"live"` from the `Check` group in
`scripts/src/verify.ts`.
