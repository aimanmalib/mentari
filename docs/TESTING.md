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
