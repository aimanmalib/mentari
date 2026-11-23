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

Counts are test functions in `contracts/test/`, by name prefix, on 2026-11-22.

| Kind | Count | Where |
|---|---|---|
| Unit (`test_*`) | 98 | `test/lib/`, `test/mentari/`, `test/AtomicityProbe.t.sol` |
| Fuzz (`testFuzz_*`) | 16 | 8 in `test/lib/`, 8 in `test/mentari/MentariFuzz.t.sol` |
| Invariant (`invariant_*`) | 4 | `test/invariant/MentariInvariant.t.sol` |

Fuzz tests run 512 cases each. The invariant suite runs 128 random sequences of 64 handler calls (8,192 calls), and checks
all four invariants after every call. Seeds are fixed in `contracts/foundry.toml`, so a run repeats exactly.

Last local run (2026-11-22): `forge test` reported 115 passed, 0 failed, 0 skipped (Foundry lists the invariant suite
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

`server/test/` runs with vitest and no internet: the upstream `fetch` is a fake, the config is a frozen fixture, so
changing `config/` never breaks a test, and the live meter job talks only to a local anvil node (as in the chain driver
tests). `cd server && npx vitest run` reported 152 passed on 2026-11-22.

They cover the `/lcd` allowlist (other paths, other contracts, `//host`, `@host`, dot segments and `%2e` are refused
without an upstream call), methods other than `GET` (405), the 5 second cache, joined concurrent requests, 502 on
failure or oversized replies, static files (no escape from the site folder, `no-transform` on HTML), the client IP
rules, and the demo sender (`/api/demo/*`). The demo tests use a fake chain whose ledgers move like the contracts, so
they hold no key and touch no network. They cover one send at a time, the per-visitor hour and the UTC day limits with
`retry-after`, the off switch, low funds, a missing sender, timeouts and failed sends, and the recorded case named in
every refusal. The wallet grant (`/api/demo/grant/<address>`) is tested for the amount from config, the receiver rule
checked before any quota is used, the shared hourly limit, a reverted transfer, and malformed addresses.

The daily meter run (`server/src/meter/daily.ts`) is tested with a fake clock and a fake job: the `HH:MM` parsing, the
next run time across a day and a year, the run at start, two daily runs, a retry after a failure that never goes past
the next daily run, one run at a time, a run that ends after `stop()`, and the two off states. Six changes to the
scheduler were each tried on purpose; four turned a test red at once. The two that did not were a missing stop check
(a test for it was then added and goes red) and dropping `unref()` on the timer, which only affects how Node exits.

The live meter job (`server/src/meter/live.ts`, decision 0014) runs on a local anvil node with the test precompile. The
tests deploy `Mentari`, register two systems and drive the job through the server's ABI subset: it attests yesterday
for each system and sends nothing on a second run, reads each meter from the chain, stops before any send when a
registered meter has no key, and fails on a system the chain does not know. The meter signer is checked with a real
ML-DSA-87 key and `pqcVerify`. The key file loader refuses a bad sender, address or key length and a meter listed twice,
and its errors never contain a key. `server/test/abi.test.ts` compares each ABI subset the server keeps (meter run,
demo sender, probe) with the Foundry build output, struct field names included. Five changes were tried on purpose (no key check before sending, a wrong sent
count, a wrong argument type, a renamed struct field, a missing error); each turned a test red.

The live demo sender (`server/src/demo/live.ts`, decision 0017) runs on a local anvil node with the bridge mock at
`0x…0901` and the receipts book on its allowlist. It signs locally with anvil's public development keys, as the server
does on the testnet, so viem estimates gas the same way. "Retire now" adds one receipt and one retirement; cases B, C
and D are mined as reverted and neither ledger moves; case D with no target, and a retirement or grant from an account
without enough certificates, send nothing (the nonce does not change); the grant pays a quantum-ready wallet. The
adapter stays on the recorded cases until both contracts and the key file exist, and logs a broken key file without
its contents. The REST count reader is tested with a fake `fetch`. Five changes were tried on purpose (no fixed gas on
the failure cases, no certificate check, no case D target check, a wrong count query, every send reported as a
success); each turned a test red.

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
| grant skips the quantum-ready check | 1 |

## Web tests

`web/test/` runs with vitest in Node and no network. `cd web && npx vitest run` reported 157 passed on 2026-11-23.

They cover the check behind the "both ledgers agree" badge (sender, note, receipt id, nothing checked), the EVM to
Native address encoding, the receipts book reader (a missing receipt is `null`, any other failure throws so the page
says it could not check), the registry read over the sample data, locale parity (same keys, same placeholders, no
empty values, every key the code asks for exists), the link preview tags and the size and weight of the committed
preview images, and that the site's ABI and the `Retired` event match
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

The wallet path adds tests for the grant client (request shape, refusals, a malformed address is never sent), the
reading of wallet errors (QoreX's "not yet supported" and "signature rejected" wording, codes 4001 and 4200, the
contract errors), and that the wallet ABI and its errors match `contracts/src/Mentari.sol`.

The link preview adds tests for `web/share-meta.ts` over a frozen config: every Open Graph and X card tag is present
once, the image address is absolute https, values come from config and the default locale, `& < > "` are escaped, a
missing `web.share` block or locale key stops the build, and `web/index.html` carries no title, description or preview
tag of its own. Removing `meta.imageAlt` from `web/locales/ms.json` fails 3 tests.

After a deploy the preview is checked on the live site with the crawlers' own user agents:

```sh
curl -sI -A 'WhatsApp/2.23' https://mentari.sasateguh.com/og.png    # 200, content-type image/png
curl -s  -A 'TelegramBot (like TwitterBot)' https://mentari.sasateguh.com/ | grep -o 'property="og:' | wc -l  # 12
```

## Script tests

`scripts/test/` runs with vitest and no network beyond a local anvil node. `cd scripts && npx vitest run` reported 89
passed on 2026-11-22.

`scripts/src/meter.ts` makes the simulated meter readings and the bytes a meter or the registrar signs. The meter tests
use a frozen config, not `config/meter.json`. Two hashes pin the signed bytes from both sides: the vitest suite checks
them for the TypeScript encoder, and `contracts/test/mentari/MentariMessages.t.sol` checks them for
`Mentari.attestMessage` and `Mentari.registerMessage` on chain id 9800 at a fixed address. If either side changes its
encoding, one of the two suites goes red. A signature made with the encoder is checked with ML-DSA-87 verification.

`scripts/src/chain.ts` deploys the contracts, registers the systems and attests the finished days (ADR 0012). Its tests
start anvil on chain id 9800 with `MockPqc` at the two precompile addresses and use anvil's unlocked accounts, so no
key is involved. They check that registration and attestation happen once (a second run sends nothing), that a daily
run followed by a backfill fills the window, that the totals match the simulated readings, and that a bad signature, a
producer without a key, bytes that differ from the contract's, a capacity that differs from the chain, and an
unregistered system all stop before anything is sent. Four checks in the driver (the bytes comparison, the
capacity comparison, the read of attested days, and treating only `UnknownSystem` as not registered) were each
removed once, and each time one test went red. The suite needs `anvil` and `forge build` output; `scripts/gerbang-ujian.sh` provides both.

`scripts/src/setup.ts` ties the driver to one testnet setup run (ADR 0015). Its tests deploy, register and backfill on
the same local node and check that a second run sends nothing, that the config is refused when it names an address with
no code, only one address, or no deploy block, that writing the addresses keeps every other key of `config/app.json`,
and that the meter keys and demo sender key files are mode 600, are read back by the server's parsers under the
file names the server looks for, and are refused inside the repository.
Removing the no-code check or the one-address check each turned one test red.

`scripts/src/native.ts` gets the accounts ready on the Native lane (ADR 0016). Its tests run against an in-memory
lane that applies bank sends, key registrations and windows, and refuses a hybrid transaction from an account with no
key or a classical transaction that is not a key registration. They check that a top-up sends only what is short, in
one transaction after the funder's key, and nothing on a second run; that the funder's reserve is kept; that a proof of
possession verifies for this account and chain only; that a different registered key, or a key left unproven, stops
the run; and that an unscoped window wide enough is kept while a scoped one is replaced. `scripts/src/lane.ts` is
tested with a fake `fetch`, and the eth-native signer offline with the SDK (the hybrid transaction is at least 4,627
bytes longer than the classical one). The settings are a frozen fixture; one test only checks that every role in
`config/app.json` maps to one account and every amount reads as QOR.

Changes checked to fail:

| Change | Tests that failed |
|---|---|
| the funder reserve check removed from `fundAccounts` | the reserve test |
| the different-key check removed from `registerKey` | the different-key test |
| the proven check after registering removed | the unproven-key test |
| key registration signed hybrid | eight `native` tests |
| every account topped up, short or not | the top-up test |
| a scoped window treated as unscoped | the scoped-window test |
| `wh` packed as `uint64` in place of `day` as `uint32` | the attest message vector |
| meter and producer swapped in the register message | the register message vector |
| the config check ignores the spread when comparing with the chain's cap | the over-the-cap config test |
| the day loop includes today, which the contract refuses | three `daysToAttest` tests |
| no upper or no lower clamp on a reading | the unchecked-config test |

## Browser tests

`web/e2e/` runs with Playwright in Chromium and in WebKit as an iPhone 13 (`playwright.config.ts`). The site is built
with `vite build --mode e2e`, which only sets a test contract address, and served by `vite preview`.
`@qorechain/qorex-wallet-mock` 0.1.0 is injected into the page, and a fake EVM node inside the test answers the chain
calls (`web/e2e/fake-chain.ts`); nothing reaches the testnet. `pnpm exec playwright test` reported 10 passed (5 cases in
2 browsers) on 2026-11-22.

| Case | What it checks |
|---|---|
| QoreX today (`current` profile) | connect, the account's addresses and key status, get 500 Wh, then the wallet refuses `eth_sendTransaction` and the page says nothing was sent; the fake node received no transaction |
| QoreX as announced (`planned` profile) | the wallet signs and sends one transaction to the contract, decoded as `retire(500, "from QoreX")`, and the page links retirement 7 |
| declined in the wallet | nothing is sent and the page says so |
| no ML-DSA-87 key | the page says so and "Get 500 Wh" is disabled |
| Bahasa Melayu | the Malay text, no sideways scroll, and no backdrop filter anywhere in the wallet dialog |

Changes checked to fail:

| Change | Tests that failed |
|---|---|
| wallet errors read with the earlier pattern, which missed QoreX's "signature rejected" | the declined case (both browsers) and its unit test |
| the wallet dialog keeps RainbowKit's default overlay blur | the Bahasa Melayu case (WebKit run) |

