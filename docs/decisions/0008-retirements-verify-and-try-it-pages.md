# 0008. Retirements, Verify and Try it pages: shared readers, event lookup, recorded-case fallback

Date: 2026-11-22. Status: accepted.

## Context

PRD section 4.7 asks for three more pages. Retirements lists each retirement as an EVM transaction next to its Native
receipt, with explorer links. Verify looks one retirement up by number or receipt id, at a URL that can be shared. Try
it sends the demo transactions through `/api/demo` and shows the counts on both ledgers before and after. When a live
send cannot run, the page must show the recorded testnet case and check it again live. The contract stores no
transaction hash, and the recorded cases do not exist until the testnet run.

## Decision

- All pages share one set of readers (`web/src/data/load.ts` `readers`, cached in `useReaders.ts`), so sample mode and
  live mode run the same code.
- The EVM transaction of retirement n comes from the `Retired` event, searched by its indexed `n` from
  `contracts.mentariDeployBlock`. If the node refuses the log search, the row still shows both ledgers and says the
  node did not return the transaction.
- The Native side of a row links to the explorer block at the receipt's height. One retirement is one transaction, so
  the block holds it.
- Explorer URL shapes are in `config/app.json` `web.explorer`. The shapes `/tx/{hash}`, `/block/{height}` and
  `/address/{address}` were read from the public explorer's own links on 2026-11-22. The testnet run must open one
  real link of each kind and change the config if a shape is wrong.
- Verify keeps its question in the query string (`?n=3` or `?receipt=6`). By receipt id, the page reads the receipt,
  requires the Mentari contract's Native address as sender, reads `n` from the note, then checks the pair. Each of the
  four checks is listed with its result.
- Try it reads `GET /api/demo/status` first. When the status says sends are off or the chain is not ready, the page
  shows the recorded case without sending. Any other failure (refusal, timeout, server down, malformed answer) also
  becomes the recorded case, with the reason in plain words.
- Recorded cases are read from `evidence/testnet.json` at build time through `import.meta.glob`, so the site builds
  before the file exists. The page re-checks a recorded case by reading the transaction's status from the EVM node. In
  sample mode the cases come from `web/fixtures/sample.json` and the page says they are samples.
- `evidence/testnet.json` must hold `{ "cases": [...] }` or a list, each case with `id`, `expect`
  (`success` or `revert`), `evm_tx`, and optionally `height`, `receipts` and `retirements` as `{ before, after }`.
  The deploy image must include this file when the site is built.
- The demo button amount comes from `config/limits.json` `demo.retireWh`.

## Consequences

- A judge can follow the three steps on Try it without a wallet, and every answer on the page names where it came from.
- On a node that limits log searches, Retirements loses only the transaction links. Verify still shows both records.
- Refused live sends (rate limits) still log one failed request in the browser console, because the server answers
  them with HTTP 429. Sends that the status already rules out make no request.

## How to undo

Remove the three routes from `web/src/router.tsx` and `web/src/App.tsx`, their nav links in
`web/src/components/Chrome.tsx`, and the files `web/src/pages/{Retirements,Verify,TryIt}.tsx`. The data modules can
stay; nothing else imports them.
