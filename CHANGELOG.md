# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The testnet contracts cannot be upgraded: a fix to a deployed
contract is a new deployment, listed here with its new address.

## [Unreleased]

### Added

- "Retire now" is sent from the Native lane: one hybrid-signed `MsgCrossVMCall` from the demo account, with no EVM
  window. The Try it panel shows the Native transaction. `config/app.json` `nativeRoute` switches the route per job
  ("Retire now" on, the daily meter off for now); the failure buttons stay EVM transactions. The key files now carry the
  ML-DSA-87 key pair, and `pnpm testnet --keys` rewrites them (decision 0026).
- `pnpm native-entry` records case H in `evidence/testnet.json`: calls into Mentari sent as hybrid-signed
  `MsgCrossVMCall` from an account with no EVM window. `retire`, with its bridge call, was accepted (retirement 5,
  receipt 14); `attest` reached the contract and reverted there. `pnpm verify` checks each step's Cosmos transaction
  and the receipt count. Write-up in `docs/findings.md` (decision 0025).
- `pnpm verify` checks the testnet record from public endpoints, with no key: every retirement against its Native
  receipt, minted - retired = supply, and each recorded case. `pnpm demo` installs the scripts in a fresh clone and
  runs it. The first run passed 28 of 28 checks (`evidence/verify.json`, decision 0024).
- `pnpm cases` records the testnet cases in `evidence/testnet.json`: a retirement that writes one receipt (A), and
  refusals that leave both ledgers unchanged (B, C, D, E2, G so far; E and F need a finished day without a reading).
  Each record has the EVM and Cosmos transaction hashes, the block, and the receipt count before and after
  (decision 0023).
- EVM windows in `config/app.json` can be scoped to named contracts; the demo sender's window reaches only `Mentari`
  and `AtomicityProbe` (decision 0023).
- Testnet deployment: `Mentari` at `0xf5cb2c6048a7ce8c5a7accc66eb8efc33942a448` and `AtomicityProbe` at
  `0x7438df055f0d96e6ba1b9ac8e7334a1be56130e4` on the Diana testnet, three simulated meters registered and three
  backfilled days attested for each. `evidence/deploy.json` lists every transaction (decision 0021).
- `pnpm native record` writes the public state of every account to `evidence/accounts.json`; the first record shows
  the eight accounts funded, each with a registered ML-DSA-87 key and a proof of possession (decision 0020).
- `deploy/funds.sh`: a low-funds watch for cron that reads public balances only and warns once when an account that
  pays for the demo drops below the line in `config/app.json` (decision 0020).
- Link preview tags: the page title, description, Open Graph and X card tags, a canonical link and an Apple touch icon
  link are written into the page head at build time from `config/app.json` `web.share` and the default locale's
  `meta` texts (decision 0018).
- Link preview image (`web/public/og.png`, 1200 × 630) and Apple touch icon (180 × 180), drawn from the site's own
  fonts, colours and brand mark by `pnpm --filter @mentari/web og` and committed (decision 0018).
- `Mentari` contract: systems registered with an ML-DSA-87 signature, daily meter readings checked with `pqcVerify`,
  transfers only to accounts with a registered post-quantum key, and `retire`, which burns and writes a receipt into
  the Native `qday-receipts` contract through the Cross-VM bridge in one transaction.
- `AtomicityProbe` demo contract for the three failure cases.
- Contract libraries for the bridge call, the receipt note, the reply reader and the post-quantum precompiles, with
  mocks of the bridge and the precompiles for tests.
- 115 Foundry tests: unit, 16 fuzz tests and 4 invariants; line coverage of `contracts/src` 99 %.
- Node server: the site, a read-only `/lcd` proxy with an allowlist, the demo sender with rate limits and an off switch,
  client IP from Cloudflare only, `/healthz`.
- Site in English and Bahasa Melayu: Registry, Retirements, Verify, Try it and How it works, on labelled sample data
  until the contracts are deployed.
- Container image, deploy script with rollback, health watch, and CI on GitHub Actions.
- `pnpm testnet`: one command deploys the contracts when the config names none, registers the simulated meters,
  backfills their readings, and writes the addresses and the meter keys file (outside the repository).
- `pnpm native`: gets the accounts ready on the Native lane before any EVM transaction. It tops each account up to
  its target from the funder in one transaction, registers each account's ML-DSA-87 key with a proof of possession,
  opens or closes the EVM window named in `config/app.json`, and reports balances, keys and windows (ADR 0016).
- "Retire from your own wallet" on the Try it page: connect QoreX with `@qorechain/qorex-rainbowkit`, ask the demo
  account for 500 Wh (`POST /api/demo/grant/<address>`), and retire from the wallet. QoreX does not sign EVM
  transactions yet, and the page says so. Browser tests with `@qorechain/qorex-wallet-mock` in Chromium and WebKit.
- README in English and Bahasa Melayu, `AI_USAGE.md`, architecture, threat model and community files.
- Simulated meter readings from a seeded model in `config/meter.json`, and the exact bytes a meter or the registrar
  signs, checked against the contract with fixed hashes on both sides (ADR 0011).
- A chain driver that deploys the contracts, registers the systems and attests the finished days, reading the chain
  first so a second run sends nothing, and simulating each call before sending it (ADR 0012).
- A daily meter run in the server: once at start, then each day at the UTC time in `config/meter.json`, with a retry
  after a failure and an off switch. It stays off until the contracts and meter keys are configured (ADR 0013).
- The live job behind that run: it reads each system's meter from the chain, signs yesterday's reading with that
  meter's ML-DSA-87 key from a key file in the read-only key folder, and sends what is missing. The server is now
  bundled with esbuild into one file, so the image still has no `node_modules` (ADR 0014).
- The live demo sender: once both contracts and the demo account's key file are in place, "Retire now" and the three
  failure buttons send real testnet transactions from the demo account and wait for them to be mined. `pnpm testnet`
  writes that key file beside the meter keys (ADR 0017).
- Eight slides in `deck/` (HTML source and PDF), linked from the README and the site footer.

### Changed

- Live demo sends are switched off in `config/limits.json` until the demo account holds certificates (decision 0022).
- Live demo sends are on again, and each failure button uses a 1,500,000 gas limit instead of 3,000,000, because the
  chain charges a failed transaction at least half its limit (decision 0023).
- The site reads the testnet contracts instead of sample data (decision 0021).
- The judge slides are generated from `deck/kandungan.json` by the judge-pack deck engine, with the site's own
  colours and fonts, and printed to `docs/deck.pdf`. A test checks that the PDF and the slide source match the hashes
  the engine recorded, and that the test-count tiles match the README (decision 0019).

### Removed

- The hand-written slides (`deck/deck.css`, `deck/deck.js`, `deck/img/sun.svg`) and the PDF printed from them.

### Fixed

- A failed or timed-out demo send answers 503 so Cloudflare keeps the reason and hash in the body (decision 0022).
