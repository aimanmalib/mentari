# 0023. The testnet cases: one script, scoped windows, reasons from a simulation

Date: 2026-11-23. Status: accepted. Follows decisions 0008, 0017, 0021 and 0022.

## Context

The contracts are on the testnet (decision 0021). The evidence must now show, with real transactions, that a
retirement writes one receipt and that every refusal leaves both ledgers as they were: cases A to G. The demo account
held no certificates and no account had an EVM window, so the live demo was off (decision 0022). Case D needs a real
Native contract that is not on the bridge allowlist.

## Decision

- `pnpm cases` (`scripts/cases.ts`, `scripts/src/cases.ts`) sends each case that `evidence/testnet.json` does not
  hold yet, from the demo sender, and writes the file after each case. A recorded case is never replaced.
- Each case that must revert is simulated first with `eth_call`. It is sent only when the simulation fails with the
  expected error, so a wrong setup costs no transaction. The mined receipt only says "reverted", so the recorded
  `revert_reason` is the simulated one. The file says this in `revertReasonFrom`.
- Receipt counts are read at the block before the transaction and at its block (`x-cosmos-block-height`), not
  "now", because other teams write to the same book. The Cosmos transaction comes from the
  `ethereum_tx.ethereumTxHash` event search on public REST.
- Case D calls `qor1k50lljx5myr6f7ctvdngdaf09erfct5rtn8yccd5sy845tphk2jqe26mpr`, another instance of the receipts
  book code (code id 865) that is not in `bridge_allowed_targets` of `/qorechain/crossvm/v1/params` (read
  2026-11-23). Same code, so the only difference from case A's target is the allowlist. It is
  `native.notAllowlistedTarget` in `config/app.json`.
- Case E has two transactions, recorded as `E` and `E2`. Case G sends 1 Wh to `0x…dEaD`, which has no ML-DSA-87 key. E2 repeats the first attested day with a correct meter
  signature. E (signed with meter B's key) and F (1 Wh over the cap, correct signature) need a finished day without a
  reading. On the day of the first run every finished day had one, so the script leaves E and F for a run after the
  next UTC midnight.
- Windows are scoped (`targets` in `config/app.json` `windows`, resolved from `contracts`): `stock` lets the producer
  move 100,000 Wh to the demo sender once (1 transaction), and `demo` lets the demo sender reach only `Mentari` and
  `AtomicityProbe`. The `demo` window stays open for the site's demo. How it is renewed is decided after the
  experiment in PRD section 4.6.
- `demo.revertCaseGas` drops from 3,000,000 to 1,500,000. The chain charges a failed transaction at least half its
  gas limit (each reverted case used exactly 1,500,000 of 3,000,000). The most expensive revert path, a bridge write
  (case B), estimates at 914,114 gas through `callTarget` to the allowlisted book, so 1,500,000 keeps a margin and
  halves the cost of each failure button. The cases recorded on 2026-11-23 were sent with 3,000,000.
- `demo.enabled` is `true` again: the demo account holds certificates and has a window.
- Explorer links, read in a browser on 2026-11-23 (decision 0008 asked for this): the shapes `/tx/{hash}`,
  `/block/{height}` and `/address/{address}` are right, but the explorer picks the network from a `qore-network`
  cookie, not from the URL, and opens on mainnet. Its `/tx/` page takes the Cosmos transaction hash; an EVM hash is
  "not found". That is why each case records `cosmos_tx`. The site's links are changed in a separate step.

## Consequences

- The Try it page shows the recorded cases from the real file, and the live buttons work while the `demo` window is
  open. When it closes, each button falls back to the recorded case, as decision 0008 describes.
- A revert reason is evidence of what the same call does just before it was sent, not a trace of the mined
  transaction. `scripts/verify` checks the mined status of every case on its own.

## How to undo

Delete `scripts/cases.ts`, `scripts/src/cases.ts`, `scripts/src/book.ts` and `scripts/src/revert.ts` with their
tests, remove `cases` and the `stock` and `demo` windows from `config/app.json`, set `demo.revertCaseGas` back to
3,000,000 and `demo.enabled` to `false`. Close the demo sender's window with `pnpm native close "demo sender"`.
`evidence/testnet.json` can stay; the transactions in it stay on the chain.
