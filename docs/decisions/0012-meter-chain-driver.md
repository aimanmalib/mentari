# 0012. One chain driver for deploy, registration and attestation, tested on a local node

Date: 2026-11-22. Status: accepted.

## Context

The contracts go on testnet once the deployer account has test QOR. After the deploy, three systems are registered
and the last few days are attested (the backfill). Later the server attests yesterday every day. A transaction the
contract refuses still costs gas, and a run that stops halfway must be safe to start again. None of this could be run
against testnet before funding, and a bug found only on testnet costs funds and time close to the deadline.

## Decision

- `scripts/src/chain.ts` holds the chain side: `deploy` (from `forge build` output), `registerSystems` and
  `attestDays`. It uses viem and takes the signer as a function, so the same code runs with ML-DSA-87 keys on
  testnet and with a stand-in signature in tests.
- Every step reads the chain first: a registered system is skipped, a day already attested is skipped. A system
  registered with other accounts or another capacity stops the run, because the chain cannot be changed to match.
- Before signing, the driver compares the bytes it built with `registerMessage` or `attestMessage` read from the
  contract. If they differ, it signs nothing and sends nothing.
- Every write is simulated first (`eth_call`), so a refused call fails with the contract's error name and costs no gas.
- The log is one line per transaction with ids, days, watt-hours and hashes. No keys.
- Tests start anvil on chain id 9800 and place `MockPqc` at the two precompile addresses. They cover the deploy,
  registration once, a daily run then a backfill then nothing, the totals, a bad signature, a producer without a key,
  bytes that differ, a capacity that differs, and an unregistered system.

## Consequences

- The vitest suite in `scripts/` now needs Foundry's `anvil` and `contracts/out`. CI installs Foundry and runs
  `forge build` before the unit tests, so the order holds there.
- The local node does not have QoreChain's EVM access window or its gas rules. Opening the window and the first real
  deploy are still testnet work.
- The daily server job can call `attestDays` with a window of 1.

## How to undo

Delete `scripts/src/chain.ts`, `scripts/test/chain.test.ts` and `scripts/test/lib/anvil.ts`. Deploys and readings
would then be sent by hand with `cast`.
