# 0004. Product contract and atomicity probe

- Status: accepted
- Date: 2026-11-21

## Context

`Mentari` mints solar energy certificates (1 MTR = 1 Wh) from meter readings signed with ML-DSA-87, lets holders move them,
and retires them. Retiring must burn on the EVM side and write a receipt into the Native `qday-receipts` book in one
transaction. A judge must also be able to see on the testnet that the two sides fail together. Decision record 0003 covers the
libraries this contract is built from.

## Decision

- **No owner, pause, upgrade, allowances or value.** Every value set in the constructor (registrar, receipts book,
  `maxSunHoursX10`) is fixed for the life of the contract. The constructor rejects a zero registrar, an empty book name and a
  sun-hours cap outside 0.1 to 24.0 hours.
- **Authority comes from post-quantum signatures, not from `msg.sender`.** Anyone may submit a registration or a reading.
  - `registerSystem` checks the registrar's ML-DSA-87 signature over
    `abi.encodePacked("Mentari:register:v1", chainid, this, nonce, id, meter, producer, capacityW, firstDay)`. The nonce
    goes up by one on each accepted registration, so a signature cannot be used twice.
  - `attest` checks the meter's signature over `abi.encodePacked("Mentari:attest:v1", chainid, this, id, day, wh)`. A day
    can be attested once, only after it has ended (`firstDay <= day < today`, UTC days), and `wh` must be between 1 and
    `capacityW * maxSunHoursX10 / 10`.
  - `registerMessage` and `attestMessage` are public views, so the signing scripts sign exactly the bytes the contract checks.
- **Only quantum-ready accounts hold certificates.** The meter and producer must have a registered, possession-proven
  ML-DSA-87 key when a system is registered; the producer is checked again on every mint, and `transfer` rejects any
  recipient without one (`NotQuantumReady`). Zero-amount transfers and retirements are rejected (`ZeroAmount`).
- **Retirement order.** `retire` checks the amount (at most 2^64-1, so the note stays within 140 characters), burns,
  builds the note with `ReceiptNote`, calls the book through `CrossVm`, reads the receipt id with `ReceiptReply`, requires it to
  be greater than the last id this contract received, and stores `Retirement{holder, wh, receiptId, timestamp}`. Any bridge
  failure, an empty reply or an unreadable reply reverts the whole transaction. A storage lock guards against re-entry. The
  `Retired` event comes after the bridge call because it carries the receipt id.
- **Views revert on unknown keys.** `system(id)` and `retirement(n)` revert with `UnknownSystem` and `UnknownRetirement`, so
  a script cannot mistake an empty record for a real one. Retirements are numbered from 1.
- **`AtomicityProbe` is a separate, labelled fixture.** Its first comment says it is a demo fixture. It holds no state besides
  the book name. `recordThenRevert` writes a receipt then reverts with `RevertedAfterNativeWrite(receiptId)`;
  `nativeRefuses` sends `{"fail":{}}`; `callTarget` sends a record to any Native contract to show the allowlist refusing it.
  Its notes follow the memo rules and start with `PROBE `, so a probe receipt can never be confused with a retirement.
- **Lints.** Four casts carry a `forge-lint` exception with the reason on the line above (amount checked, count, timestamp,
  day number). The two events emitted after the bridge call carry a `reentrancy-events` exception with the reason.

## Consequences

- A registrar or meter that loses its key cannot sign; a new contract version is the only fix, by design.
- Readings for days before a system's `firstDay` can never be minted, and a missed day can still be attested later.
- The per-retirement storage write and the strict reply reader cost gas, which is small next to the bridge call.

## How to undo

Testnet contracts cannot be upgraded. To change behaviour, deploy a new `Mentari` (and probe, if needed), point
`config/app.json` keys `contracts.mentari` and `contracts.atomicityProbe` at the new addresses, record it in `CHANGELOG.md`
and add a decision record that supersedes this one.
