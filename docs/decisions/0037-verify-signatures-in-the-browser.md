# 0037. Re-check the meters' ML-DSA-87 signatures in the visitor's browser

Date: 2026-11-24. Status: accepted. Follows decision 0026 (Native lane) and decision 0031 (daily meter on the
Native lane).

## Context

The chain checks every meter reading with its `pqcVerify` precompile before `Mentari.attest` mints. A visitor could
only take that on trust: the site showed no signature and no way to check one. I first measured whether a browser
can check the same signatures from public data alone, on 2026-11-24:

- Each Native-lane reading is a `MsgCrossVMCall` whose `payload` is the full `attest(id, day, wh, sig)` calldata.
  `GET /cosmos/tx/v1beta1/txs?query=crossvm_request.target_contract='<contract>'` lists them, newest first.
- The query only matches the checksummed address. The lower-case form in `config/app.json` returned 0 transactions.
- `pqcKeyStatus(meter)` at the key registry precompile answers an `eth_call` on the public EVM RPC with the 2,592-byte
  key, algorithm 1 (ML-DSA-87) and possession proven.
- The message rebuilt with `encodePacked` equals `Mentari.attestMessage(id, day, wh)` read from the contract.
- `ml_dsa87.verify` from `@noble/post-quantum` 0.7.1 accepted all three readings on the testnet (systems 1, 2 and 3,
  day 20780) in 5 to 36 ms each in Node, and rejected each signature with one byte changed.

## Decision

- The server answers `GET /api/readings` (`server/src/readings.ts`). It reads the query above through the `/lcd`
  cache, keeps accepted `attest` calls into the contract and returns their Cosmos hash, height and raw calldata. It
  never says whether a signature is valid. `config/limits.json` `readings` sets how many readings, how many REST
  pages and how long the list is cached. The `/lcd` allowlist does not grow.
- Verify has a new section under the lookup (`web/src/components/PqRecheck.tsx`). The browser decodes each reading,
  rebuilds the signed bytes, reads the meter from `system(id)` and its key from `pqcKeyStatus`, and verifies in a Web
  Worker (`web/src/data/pqWorker.ts`), so the page stays responsive. It also reads `attested(id, day)`: the browser
  and the chain agree when a valid signature belongs to a recorded reading.
- A "Check a tampered copy" button changes one byte of the newest signature and checks it again, so a visitor sees
  the check can say no.
- `@noble/post-quantum` is pinned to 0.7.1 in `web/package.json` (it was already in the lockfile through the SDK).
- `web/test/fixtures/readings.json` freezes the three readings and the meter keys from the testnet. The tests use
  these real signatures, a one-byte mutant and a message built for another contract.

## Consequences

- Only readings sent from the Native lane are listed. Older readings sent from the EVM lane are not. While
  `nativeRoute.meter` stays on, every new reading is listed.
- Certificates are fungible, so a retirement has no readings of its own. The section shows the newest readings, not
  the readings behind one retirement.
- If the REST API is down, the section says it could not read the readings; the lookup above it still works.

## How to undo

Remove `{siteMode === "live" && <PqRecheck />}` from `web/src/pages/Verify.tsx` and the `READINGS_MOUNT` line from
`server/src/app.ts`. The component, data files, worker, test fixture, `readings` block in `config/limits.json`,
`pqcKeyRegistry` and `readingsApi` in `config/app.json` and the `verify.pq` locale keys can then be deleted together.
