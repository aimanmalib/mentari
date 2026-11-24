# 0036. How it works shows the Native lane finding

Date: 2026-11-24. Status: accepted.

## Context

The QoreChain Cross-VM reference marks "Native account to EVM contract" as "Not yet tested against the live network:
this direction was not run for this page." Case H in `evidence/testnet.json` ran that direction: one hybrid-signed
`MsgCrossVMCall` called `Mentari.retire` with no EVM window open and wrote one Native receipt. Retire now uses the same
route. The finding was only in `docs/findings.md`. The How it works page did not show it.

## Decision

- How it works has a new section after the retire steps (`web/src/components/NativeFinding.tsx`): the quote with a
  link to the docs section, one paragraph on what I ran, two transaction links and the explorer note.
- The route Native → EVM → Native is drawn as an SVG column (`NativeRouteDiagram`). SVG, because WebKit under
  Playwright does not paint CSS perspective. A column reads the same at 320 px and 1440 px.
- The docs link and both Cosmos hashes live in `config/app.json` `web.nativeFinding`. The text lives in
  `web/locales/{en,ms}.json` `how.native`. The quote stays in English in both locales, marked `lang="en"`.
- `web/test/native-finding.test.tsx` checks that `caseTx` is case H's accepted retire step (window closed, receipts +1)
  and that `retireTx` is a recorded Retire now press that succeeded in `evidence/live.json`.

## How to undo

Remove `<NativeFinding />` from `web/src/pages/HowItWorks.tsx`. The config block, locale keys, `native.css` and the
test can then be deleted together.
