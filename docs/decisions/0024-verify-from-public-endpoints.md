# 0024. `pnpm verify` reads public endpoints only and says when a node cannot answer

Date: 2026-11-23. Status: accepted. Follows decisions 0008 and 0023.

## Context

A judge should be able to check the testnet record without keys, without our accounts file and without building the
contracts. Two things on the chain change over time: the live demo adds retirements, and a public node may prune old
state, so a read "at block N" that works today may not work in a month.

## Decision

- `pnpm verify` (`scripts/verify.ts`, checks in `scripts/src/verify.ts`) reads the EVM JSON-RPC and the REST endpoint
  named in `config/app.json`, and the cases in `evidence/testnet.json`. It uses a small read-only ABI written in
  `scripts/src/mentari-reader.ts`, so it does not need `forge build` output.
- It checks:
  - both contracts have code, and `Mentari.receiptsBook()` is the book in `config/app.json`;
  - every retirement, 1 to `retirementsCount()`, against `receipt{id}` in the Native book: the receipt exists, its
    sender is the Mentari contract's Native address, and its note starts with `MTR1 n=<n> wh=<wh> by=<holder> m=`,
    so number, amount and holder all match;
  - receipt ids rise with the retirement number;
  - `minted - retired = supply`, and the retirements add up to `retired`;
  - for each recorded case: the EVM receipt has the expected status and went to the recorded contract, the Cosmos
    hash found by the node is the recorded one, the receipts book count went up (case A) or stayed the same (every
    other case) between the block before and the case's block, and case A's receipt reads as recorded.
- A check is `pass`, `fail` or `unavailable`. `unavailable` is only for reads the node may not serve later: the Cosmos
  transaction search and the book count at a past height. It is printed and not counted as passed. Verify exits 0
  when no check fails and at least one passes. Everything else that cannot be read is an error and exits 1.
- `pnpm verify --record` writes the summary and the list of checks to `evidence/verify.json`. The README and the site
  quote that file, not a number typed by hand. The count grows with each live retirement, so the file says when it
  was read.
- `pnpm demo` is the one command for a fresh clone: it installs the scripts package only (`--frozen-lockfile`) and
  runs `pnpm verify`.

## Consequences

- Verify takes about half a minute on the public endpoints today and grows with the number of retirements; it reads
  four retirements at a time.
- A pruned node turns some case checks into `unavailable` without failing verify. The EVM status of each case is
  still required.

## How to undo

Remove `scripts/verify.ts`, `scripts/src/verify.ts`, `scripts/src/mentari-reader.ts`, their test, the `verify` and
`demo` scripts in both `package.json` files, and `evidence/verify.json`. Nothing else depends on them.
