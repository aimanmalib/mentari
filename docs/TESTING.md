# Testing

All contract tests run on a plain Foundry EVM with no chain connection. The CrossVM bridge (`0x…0901`) and the two
post-quantum precompiles (`0x…0a01`, `0x…0a02`) are replaced by mocks installed with `vm.etch` (decision record 0003).
Evidence from the public testnet is a separate step and lives in `evidence/`.

Run everything the CI runs:

```sh
bash scripts/gerbang-ujian.sh
```

Contracts only:

```sh
cd contracts && forge test && forge fmt --check && forge coverage --report summary
```

## What is tested

Counts are test functions in `contracts/test/`, by name prefix, on 2026-11-21.

| Kind | Count | Where |
|---|---|---|
| Unit (`test_*`) | 96 | `test/lib/`, `test/mentari/`, `test/AtomicityProbe.t.sol` |
| Fuzz (`testFuzz_*`) | 16 | 8 in `test/lib/`, 8 in `test/mentari/MentariFuzz.t.sol` |
| Invariant (`invariant_*`) | 4 | `test/invariant/MentariInvariant.t.sol` |

Fuzz tests run 512 cases each. The invariant suite runs 128 random sequences of 64 handler calls (8,192 calls), and checks
all four invariants after every call. Seeds are fixed in `contracts/foundry.toml`, so a run repeats exactly.

Last local gate run (2026-11-21): `forge test` reported 113 passed, 0 failed, 0 skipped (Foundry lists the invariant suite
as one entry); line coverage of `contracts/src` 99 %; `forge fmt --check` clean.

### Fuzz properties

Through the libraries:

- A note built from any memo bytes is either refused (`BadMemo`) or at most 140 characters, with no quote, backslash or
  control character, so the `{"record":{"note":"…"}}` frame keeps exactly six quotes.
- A memo of allowed characters is kept verbatim.
- The reply reader returns any id from 1 to 2^64-1 that round-trips, and refuses truncated replies, trailing bytes and
  arbitrary bytes with `BadReply` only.
- The bridge reply unwraps for any payload; only the matching ML-DSA-87 key signs.

Through `Mentari`, end to end with the mocks:

- `attest` refuses every reading of zero or above `capacityW * maxSunHoursX10 / 10`, for any capacity, and mints exactly
  any reading inside the range.
- A reading signed for another chain id or another contract address is refused.
- `retire` with any memo bytes either refuses the memo and changes nothing, or writes a safe note of at most 140 characters.
- Any amount up to the balance retires; any amount above it changes nothing.
- Any bytes the bridge replies with are either a valid receipt id or roll the burn back.
- A refusing Native contract or an inactive bridge always rolls the burn back.
- Transfers keep supply constant and never reach an account without a proven key.

### Invariants

A handler (`test/invariant/MentariHandler.sol`) drives three registered systems through readings, transfers, retirements,
retirements while the bridge fails, and days passing. Paths that must fail are wrapped in `try`/`catch` and left in state,
so the invariants see any that succeed. Any other revert fails the suite (`fail-on-revert` is on for it).

| | Invariant | Test |
|---|---|---|
| I1 | Minted minus retired equals supply, and supply equals what the actors hold | `invariant_mintedMinusRetiredIsSupply` |
| I2 | Retirements equal the receipts the bridge accepted from the contract | `invariant_retirementsMatchReceipts` |
| I3 | Receipt ids are unique and strictly increasing, and each receipt names the contract and the retirement | `invariant_receiptIdsUniqueAndIncreasing` |
| I4 | No address without a proven quantum key holds certificates | `invariant_noBalanceWithoutQuantumKey` |

I4 assumes a key, once proven, stays proven during the run. The mock has no key revocation; if the chain revokes a key, the
balance stays where it was and only new transfers to that address are refused.

### Checking that the invariants can fail

Each invariant was run against a deliberately broken copy of `Mentari.sol` (32 sequences each) and went red:

| Change to the contract | Invariants that failed |
|---|---|
| `retire` no longer adds to `retired` | I1 |
| `transfer` no longer checks the recipient's key | I4, I1 |
| `retire` stores each retirement twice | I2, I3 |
| `retire` stores the wrong receipt id | I3 |

Foundry saves a failing sequence under `contracts/cache/` and replays it first on the next run. Delete
`contracts/cache/invariant` after such an experiment, or the replayed sequence hides what the next change does.

## Server tests

`server/test/` runs with vitest and no network: the upstream `fetch` is a fake and the config is a frozen fixture, so
changing `config/` never breaks a test. `cd server && npx vitest run` reported 77 passed on 2026-11-22.

They cover the `/lcd` allowlist (other paths, other contracts, `//host`, `@host`, dot segments and `%2e` are refused
without an upstream call), methods other than `GET` (405), the 5 second cache, joined concurrent requests, 502 on
failure or oversized replies, static files (no escape from the site folder, `no-transform` on HTML), the client IP
rules, and the demo sender (`/api/demo/*`). The demo tests use a fake chain whose ledgers move like the contracts, so
they hold no key and touch no network. They cover one send at a time, the per-visitor hour and the UTC day limits with
`retry-after`, the off switch, low funds, a missing sender, timeouts and failed sends, and the recorded case named in
every refusal.

Each guard was removed from a copy of the code to check that a test notices:

| Change to the server | Tests that failed |
|---|---|
| `/lcd` forwards any path (allowlist check removed) | 3 |
| origin and normalised-path check removed | 1 |
| `cf-connecting-ip` believed from any peer | 3 |
| first `x-forwarded-for` entry used instead of the last | 2 |
| demo accepts any content type | 2 |
| demo counts a send before the balance check | 1 |
| demo frees the slot on timeout instead of when the chain call ends | 1 |
| per-visitor window shortened to half an hour | 1 |
| demo off switch ignored | 2 |

## Web tests

`web/test/` runs with vitest in Node and no network. `cd web && npx vitest run` reported 109 passed on 2026-11-22.

They cover the check behind the "both ledgers agree" badge (sender, note, receipt id, nothing checked), the EVM to
Native address encoding, the receipts book reader (a missing receipt is `null`, any other failure throws so the page
says it could not check), the registry read over the sample data, locale parity (same keys, same placeholders, no
empty values, every key the code asks for exists), and that the site's ABI and the `Retired` event match
`contracts/src/Mentari.sol`.

The Retirements, Verify and Try it pages add tests for: paging newest first, rows kept when the node refuses the event
search, lookup by retirement number or receipt id (not found, a receipt from another sender, a receipt naming a
retirement the contract does not have, ids that do not point to each other, a wrong note), the demo client (request
shape, strict reading of the server's answer, every failure becomes the recorded case, the four routes match
`server/src/demo/api.ts`), recorded cases and their live re-check, explorer links, and rendered components in both
languages through `react-dom/server`.

| Change to the web data layer | Tests that failed |
|---|---|
| sender of the receipt not compared | 2 |
| note prefix without the trailing ` m=` (so `n=70` passes for `n=7`) | 2 |
| "agree" when retirements exist but none was checked | 1 |
| every receipts book error treated as "not found" | 1 |
| Verify accepts a receipt whose retirement points to another receipt | 1 |
| Verify skips the receipt sender check | 1 |
| demo result "as expected" read loosely (any truthy value) | 1 |
| Try it sends even when the status says the chain is not ready | 1 |
| re-check calls an unknown transaction "confirmed" | 1 |
| Verify by number marks the sender check as passed whatever the receipt sender | 1 |
| demo result accepts any `0x` string as the transaction hash | 1 |
