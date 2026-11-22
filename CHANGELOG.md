# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The testnet contracts cannot be upgraded: a fix to a deployed
contract is a new deployment, listed here with its new address.

## [Unreleased]

### Added

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
- Eight slides in `deck/` (HTML source and PDF), linked from the README and the site footer.
