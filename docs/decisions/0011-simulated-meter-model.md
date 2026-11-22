# 0011. Simulated meter readings from a seeded model in config

Date: 2026-11-22. Status: accepted.

## Context

Mentari mints certificates from daily meter readings signed with ML-DSA-87. There are no real panels behind the demo,
and real customer generation data is out of scope. The readings are simulated, and the site labels them that way.
The same readings are needed in two places: a backfill of the last few days when the contracts are deployed, and a
daily run that attests yesterday for each system. A reading the chain refuses (above `capacityW * maxSunHoursX10 / 10`,
zero, today or earlier than the system's first day) wastes a transaction.

## Decision

- `config/meter.json` holds the model: a seed, mean daily sun hours, a spread, `maxSunHoursX10` (the value passed to
  the `Mentari` constructor), the backfill window, and each system's id, label and capacity in watts.
- A day's sun hours are `mean ± spread`, picked from `sha256(seed:id:day)`. The same inputs always give the same
  reading, so a re-run after a crash signs the same bytes and the contract's "once per day" check makes it a no-op.
- The config check refuses a model whose highest value is above the chain's cap, so a bad edit fails before any
  transaction. The reading is still clamped to `1..maxWh` as a second guard.
- `daysToAttest` lists finished days in the window that are on or after the first day and not yet attested. A window
  of 3 is the backfill, and a window of 1 is the daily run.
- The message bytes are built off chain with `encodePacked` in the contract's field order, and two fixed hashes are
  checked on both sides (vitest and Foundry).
- Signatures use deterministic ML-DSA-87 signing from `@qorechain/sdk`.

## Consequences

- Changing the seed, the sun hours or a capacity is a config edit. Readings for days already attested stay on chain.
- A capacity is fixed at registration. Changing it in config after the systems are registered does not change the
  chain; it only changes what the next run would try to attest, and readings above the registered cap would be refused.
- No network is needed to test any of this.

## How to undo

Delete `scripts/src/meter.ts`, `scripts/test/meter.test.ts` and `contracts/test/mentari/MentariMessages.t.sol`, and
drop the `maxSunHoursX10`, `backfillDays`, `model` and `capacityW` fields from `config/meter.json`. Readings would then
have to come from another source and be signed by hand.
