# 0021. The contracts go on the testnet with one unscoped window, closed right after

Date: 2026-11-23. Status: accepted. Builds on decisions 0015, 0016 and 0020.

## Context

Decisions 0015 and 0016 set the order for the first deployment: open an unscoped EVM window for the deployer, run
`pnpm testnet`, then close the window. The steps were only tested on a local node. This records what the real run
did and what it leaves open.

## Decision

- On 23 November 2026 the deployer opened the `deploy` window from `config/app.json` (3,600 blocks, 30 transactions,
  8 QOR) and `pnpm testnet` ran once: it deployed `Mentari` at `0xf5cb2c6048a7ce8c5a7accc66eb8efc33942a448` (block
  10,606,924) and `AtomicityProbe` at `0x7438df055f0d96e6ba1b9ac8e7334a1be56130e4`, registered the three simulated meters
  with the registrar's ML-DSA-87 signature, and attested three backfilled days for each meter. All fourteen transactions
  succeeded. Then `pnpm native close "funder and deployer"` closed the window, so no account keeps an unscoped window.
- `evidence/deploy.json` records every transaction hash, block and gas used, and `totals()` read after the run
  (344,115 Wh minted, none retired). It was written from the transaction receipts on the public EVM RPC, so anyone can
  check it against the chain.
- The code needed no change. The deployer pays gas for registrations and readings; the registrar and the meters only
  sign, so only the deployer needed a window. The real ML-DSA-87 precompile accepted every signature the local test
  precompile accepted. Gas used on the testnet: 3,139,965 for `Mentari`, 1,687,515 for `AtomicityProbe`, about 266,000
  to 283,000 per registration and 252,000 to 303,000 per reading.
- The site now reads the testnet: `contracts.*` in `config/app.json` is set, which turns the web pages from sample mode
  to live mode (decision 0007) and arms the server's meter job and demo sender (decisions 0014 and 0017).

## Consequences

- The server's daily meter run sends from the registrar, and the demo sender from its own account. Neither has an EVM
  window now, so the chain refuses what they send until each has one. Opening a window for them on a schedule, or
  using the Native path from the E1 experiment, is decided after that experiment, as decision 0016 says.
- The demo sender holds no certificates yet. The producer has to transfer some to it before "Retire now" can send,
  which comes with the testnet cases.
- The contracts cannot be upgraded. A fix is a new deployment with new addresses in `config/app.json`, a CHANGELOG entry
  and a new decision.

## How to undo

Set `contracts.mentari`, `contracts.atomicityProbe` and `contracts.mentariDeployBlock` in `config/app.json` back to empty
and zero and redeploy the site: it returns to sample mode and the server jobs stay off. The contracts stay on the
testnet; they hold test QOR only.
