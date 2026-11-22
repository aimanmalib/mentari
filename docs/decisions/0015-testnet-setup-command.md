# 0015. One command sets up the testnet contracts and meters

Date: 2026-11-22. Status: accepted. Builds on decisions 0012 and 0014.

## Context

The chain driver (decision 0012) can deploy, register and attest, and the server's daily job (decision 0014) turns on
once `contracts.mentari` is set and `meter-keys.json` is in the key folder. Nothing yet tied these together with the
real accounts: someone had to deploy by hand, copy addresses into `config/app.json` and write the key file. Done by
hand, a typo in the config or a second deploy over a working one is easy, and the key file is the kind of thing that
ends up in a terminal history.

## Decision

- `scripts/src/setup.ts` holds the steps, with no key material and no network of its own:
  - `deployIfMissing` deploys `Mentari` and `AtomicityProbe` only when both addresses in the config are empty. When
    both are set it checks that code is at each one and that the deploy block is set, and keeps them. An address with
    no code, or only one address set, stops the run: the config points somewhere else and a second deploy would hide that.
  - `setupTestnet` deploys when needed, registers every system with its first day at the start of the backfill window
    (`backfillDays` in `config/meter.json`), then attests the finished days in that window. Each step reads the chain
    first, so a second run sends nothing.
  - `writeContractsConfig` replaces the `contracts` block of `config/app.json` and leaves every other key.
  - `writeMeterKeys` writes `meter-keys.json` (mode 600, folder mode 700) through a temporary file and a rename. It
    refuses a relative folder or one inside the repository. Its output is read back by the server's own parser in the tests.
- `scripts/testnet.ts` (`pnpm testnet`) derives the accounts from the shared accounts file by the roles in
  `config/app.json` (deployer, registrar, `meter A` to `meter C`, producer), signs registrations with the registrar's
  ML-DSA-87 key and readings with each meter's key, and prints addresses, days, amounts and hashes only. It writes the
  addresses when it deployed, and the key file when `MENTARI_SECRETS_DIR` is set. The gas account in the key file is
  the registrar, never the demo sender.
- Opening the EVM window and registering the ML-DSA-87 keys stay outside this command. They are Cosmos transactions
  with their own rules (a window advances the nonce; deploy needs an unscoped window), and they are done once per
  account before the first run.

## Consequences

- When the testnet has funds, setup is one command followed by a redeploy of the site.
- The command is tested on a local anvil node with the test precompile. Gas prices, window rules and the real
  precompile are only met on the testnet; differences found there get their own decision.

## How to undo

Delete `scripts/testnet.ts` and `scripts/src/setup.ts` with their test, and the `testnet` script in both
`package.json` files. The driver in `scripts/src/chain.ts` still deploys, registers and attests on its own.
