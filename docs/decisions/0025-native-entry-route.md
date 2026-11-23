# 0025. Calls from the Native lane need no EVM window: record case H and move the demo sender to that route

Date: 2026-11-23. Status: accepted. Follows decisions 0016, 0017 and 0023. Findings: [`docs/findings.md`](../findings.md).

## Context

Before this test, every Mentari transaction was an EVM transaction, so each sending account needed an EVM
authorisation window opened on the Native lane, scoped to our contracts and renewed when it runs out. The plan set
before the test was: if a hybrid-signed `MsgCrossVMCall` into `Mentari.retire` (with its nested bridge call) is
accepted with no window, the demo sender and the meter move to that route; if only a plain call is accepted, only the
meter moves; if neither, everything stays on scoped windows.

On 23 November `pnpm native-entry` sent both from account 6, which has never opened a window. Step 2 (`retire`) was
accepted: one Native transaction ran the EVM contract, which wrote a receipt in the Native book through the bridge.
Step 1 (`attest`) reached the contract and reverted there with `AlreadyAttested`, because no day without a reading was
left; the chain did not refuse it.

## Decision

- Case H is recorded in `evidence/testnet.json` as `nativeEntry`, apart from `cases`. It has a Cosmos transaction
  and no EVM transaction of its own, so `pnpm verify` does not read it as a case; its retirement is checked with every
  other retirement. `pnpm cases` keeps `nativeEntry` when it rewrites the file.
- `pnpm native-entry` refuses to send while the sender has a live EVM window, records a refusal instead of retrying,
  and uses a fixed gas limit (`config/app.json` `nativeEntry.gas`), because a simulation would hide a refusal behind an
  estimate error.
- The test ran from account 6, not the demo sender (account 7): account 7's window serves the live demo, and the
  question is about an account with no window, which account 6 is.
- Route: step 2 was accepted, so the demo sender's "Retire now" and the daily meter job move to the Native route,
  signed hybrid. The server then needs the demo sender's ML-DSA-87 key in the same read-only secrets folder as its
  EVM key. That is the next piece of work. Until it ships, the scoped window path stays as it is and keeps working.
- The failure buttons (cases B, C, D) stay on the EVM route for now: their point is the EVM-to-Native atomicity, and
  they already work.

## Consequences

- A judge can see one hybrid-signed transaction that crosses Native, EVM and Native in order, from public data:
  the Cosmos transaction and the receipt it wrote.
- The docs page I read says the bridge is admitted only with an open window; the testnet did not hold this account to
  that. If the chain changes, `pnpm native-entry --again 2` shows it, and the window route is still in the code.
- Each step costs 0.3 QOR in fees at the configured gas (2,000,000 at 0.15 uqor); step 2 used about 1,009,000 gas.

## How to undo

Remove `scripts/native-entry.ts`, `scripts/src/native-entry.ts`, their test, the `native-entry` scripts in both
`package.json` files, `nativeEntry` in `config/app.json` and in `evidence/testnet.json`, and `docs/findings.md`. The
lane's `submit` and the `nativeEntry` carry-over in `mergeEvidence` can stay; nothing else uses them. If the route move
has shipped, set the demo sender back to the EVM window path.
