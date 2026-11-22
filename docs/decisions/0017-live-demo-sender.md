# 0017. The live demo sender

Date: 2026-11-22. Status: accepted. Completes the chain side left open in decision 0006.

## Context

Decision 0006 put the demo buttons behind the `DemoChain` interface and left the server on `unconfiguredChain`, so
every button shows a recorded case. The live adapter needs the demo account's key, the two contract addresses, and a
way to count both ledgers. The failure cases must reach the chain as mined, reverted transactions: a local signer
estimates gas before it sends, and estimating a call that reverts fails before anything is sent.

## Decision

- `server/src/demo/live.ts` sends with viem. "Retire now" calls `Mentari.retire(retireWh, retireMemo)`. Cases B, C and
  D call `AtomicityProbe.recordThenRevert`, `nativeRefuses` and `callTarget` with a fixed gas limit
  (`demo.revertCaseGas`), so they are sent without an estimate and mined as reverted. Each send waits for its receipt
  and reports the mined status.
- Counts: retirements from `Mentari.retirementsCount()`, receipts from the receipts book `count` query over public
  REST, with the `/lcd` timeout.
- The key is one file, `demo-sender.json` (`{ "privateKey": "0x…" }`), in the same read-only key folder as the meter
  keys. `pnpm testnet` writes it beside `meter-keys.json` when `MENTARI_SECRETS_DIR` is set. Errors name the file and
  field, never the value.
- The server switches to the live adapter only when both contract addresses are set and the key file exists. A broken
  key file is logged once and the buttons stay on the recorded cases.
- Before a retirement or a wallet grant the adapter reads the demo account's certificate balance and stops without
  sending when it is short. Nothing else is sent on the visitor's behalf.
- Values live in config: `demo.retireMemo`, `demo.probeNote` and `demo.revertCaseGas` in `config/limits.json`, and
  the case D target in `config/app.json` `native.notAllowlistedTarget`. The target is empty until a Native contract
  that is not on the allowlist is measured on the testnet; while it is empty, case D sends nothing and the page shows
  the recorded case.
- The server's ABI subsets moved to `server/src/abi.ts`, one per caller, all checked against the Foundry build.

## Consequences

- The demo account needs certificates as well as QOR. It holds none after deployment: the producer has to transfer
  some to it (the producer and the demo account are both quantum ready, so `transfer` accepts it).
- A case D click while no target is set still uses one of the visitor's sends, because the quota is taken before the
  adapter is called. This lasts only until the target is configured.
- The tests run the adapter on a local anvil node with the bridge mock at `0x…0901`, signing locally with anvil's
  public development keys, so gas is handled the way it is on the testnet.

## How to undo

Point `server/src/main.ts` back at `unconfiguredChain`, or remove `demo-sender.json` from the key folder and restart:
every button then shows its recorded case, as before this decision.
