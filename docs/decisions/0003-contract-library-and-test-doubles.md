# 0003. Contract library and test doubles

- Status: accepted
- Date: 2026-11-21

## Context

Mentari's contracts talk to three QoreChain precompiles: the CrossVM bridge (`0x…0901`), `pqcVerify` (`0x…0a01`) and
`pqcKeyStatus` (`0x…0a02`). Foundry's EVM has none of them. The product contract must stay small and easy to review, and the
risky parts (building a JSON message, reading a JSON reply, trusting a post-quantum key) need tests of their own.

## Decision

- **Four internal libraries in `contracts/src/lib/`**, each with one job:
  - `CrossVm`: calls `executeCrossVMCall(uint8,string,bytes)` with a normal `call`. A failed call reverts with
    `BridgeCallFailed(reason)`; an empty reply reverts with `BridgeNotActive` (an inactive precompile address answers with no
    data). The reply is unwrapped from ABI `bytes`, with a check that the declared length fits the data; a raw reply from older
    nodes is passed through. This follows the workshop 3 example, credited in `NOTICE`.
  - `ReceiptNote`: builds `MTR1 n=<n> wh=<wh> by=0x<40 hex> m=<memo>` from typed fields. The memo is 0 to 40 characters from
    `[A-Za-z0-9 .:/#-]`, and `n` and `wh` are `uint64`, so a note is at most 140 characters and can never contain a quote, a
    backslash or a control character. The message is `{"record":{"note":"…"}}`.
  - `ReceiptReply`: reads `id` from the receipts book's reply only after checking the whole reply as JSON: one object, `id`
    exactly once at the top level, a plain integer from 1 to 2^64-1, no escaped top-level keys, nesting at most 8 deep. The
    expected shape is the stored receipt, `{"id":…,"sender":…,"note":…,"height":…}`, as the workshop 3 Native contract sets it
    with `set_data`. The real reply is measured on the testnet in the evidence step; if it differs, the mock and this record
    are updated.
  - `Pqc`: reads the key with `pqcKeyStatus` on every use and accepts it only when it is registered, uses algorithm 1
    (ML-DSA-87), is 2592 bytes and has `possessionProven`. Signatures must be 4627 bytes. Static calls are low level, so an
    inactive precompile gives `PqcUnavailable` rather than a decoding panic. This follows the workshop 2 vault.
- **Test doubles installed with `vm.etch`** at the precompile addresses (`contracts/test/mocks/`):
  - `MockCrossVmBridge` plays the bridge and the receipts book together: allowlisted targets only, VM 1 only, no value, static
    calls fail because a call writes state, `{"fail":{}}` is refused, receipts are counted globally and per caller. Modes make
    the target refuse, make the bridge look inactive (empty reply), or return chosen reply bytes.
  - `MockPqc` plays both PQC precompiles. It does not compute ML-DSA-87: a signature is valid when it is 4627 bytes and starts
    with `keccak256(pubkey, message)`. Tests can sign for any key without real key material.
- **Pinned tools**: Solidity 0.8.28, forge-std v1.16.2 (git submodule), Foundry v1.8.7 and gitleaks 8.30.1, downloaded by
  `scripts/gerbang-ujian.sh` with a sha256 check when they are missing.
- **Lints**: all Foundry lints stay on except `uninitialized-local` (zero defaults are normal Solidity) and
  `require-revert-in-loop` (the reply reader and memo check must stop at the first bad byte). The build runs with
  `--deny-warnings`.
- **Test gate** (`scripts/gerbang-ujian.sh`): build, format check, tests, line coverage of `contracts/src` at least 90 % once
  product contracts exist, TypeScript type check and tests, and a gitleaks scan of history and working tree with the default rules. The repo has no `.gitleaks.toml`: an allowlist is
  a decision for the owner, so the working tree scan copies out only the files git would publish instead. A test step fails
  if no test ran or any test was skipped. CI runs the same script: `.github/workflows/ci.yml` on GitHub and
  `.depot/workflows/gerbang.yml` on Depot (generated from a shared template, comments removed so tracked files stay in English).

## Consequences

- The mocks encode our reading of the docs. Testnet evidence is the check on that reading; a difference becomes a fix here.
- `ReceiptReply` costs more gas than reading a fixed prefix. Replies are about 200 bytes, so the cost is small next to the
  bridge call, and a malformed reply can never produce an id.

## How to undo

The libraries are internal, so they compile into each contract that uses them. To change one, deploy a new contract version,
update `config/app.json`, and record it in `CHANGELOG.md` and a new decision record. To drop the strict reply reader, replace
`ReceiptReply.readId` with a prefix match on `{"id":` and remove its tests.
