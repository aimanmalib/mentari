# 0026. Send "Retire now" from the Native lane, with a switch per job

Date: 2026-11-23. Status: accepted. Follows decision 0025 (case H) and 0017 (the live demo sender). Extended by decision 0030: the failure buttons and the grant now have their own Native route switches.

## Context

Case H showed that a hybrid-signed `MsgCrossVMCall` into `Mentari.retire`, sent by an account with no EVM window,
runs in one Native transaction: Native to EVM, then back to the Native receipts book through the bridge. Decision 0025
moved the demo sender's "Retire now" and the daily meter job to that route, once the server could sign it.

The server had only the demo sender's EVM key. A hybrid signature also needs the account's registered ML-DSA-87 key,
and the server holds no seed phrase, so it must sign from the two keys alone.

## Decision

- `server/src/native.ts` signs and sends one `MsgCrossVMCall` per call, from the secp256k1 key and the ML-DSA-87 key
  pair, over public REST. It rebuilds the account (addresses, compressed public key) from the keys, waits for the
  block, and reports `success` or `reverted`. A refusal before any block is an error, so the demo falls back to the
  recorded case.
- The key files carry the ML-DSA-87 pair: `demo-sender.json` gets `pqcSecretKey` and `pqcPublicKey`, `meter-keys.json`
  gets `senderPqc`. Both are optional. `pnpm testnet --keys` rewrites the two files and sends nothing.
- `config/app.json` `nativeRoute` holds a switch per job and the gas limits: `demoRetire` (on), `meter` (off), and
  `retireGas` 1,300,000 (case H used 1,009,253). A switch that is on with no ML-DSA-87 key in the file logs that and
  keeps the EVM route.
- The failure buttons (cases B, C, D) and the wallet grant stay EVM transactions. Their point is the EVM-to-Native
  atomicity, and they need the scoped window the demo sender already has.
- The demo API answers `cosmosTx` instead of `evmTx` for a call sent this way, and `txStatus` for both. The Try it
  panel names the Native transaction and says how it was sent. The Retirements page cannot find an EVM transaction
  for these retirements (the chain returns no EVM log for them), and now says why.
- The meter switch stays off for now. Turning it on before 24 November would let the 00:20 UTC run attest the day
  that cases E and F need without a reading. It is turned on after they are recorded, in its own change.

## Measured on the testnet

Three "Retire now" presses on the live site on 23 November, each one Native transaction from the demo sender
(`qor1skd69eq006yju57wykhx0dul82900u4nr4d3f4`), each moving both ledgers by one. The first,
`EDAEF9C88E6C44FF39029F642A3B6CCDFA2423A2317CE44B58ED606B71124F0F` at block 10616439, used 1,005,093 gas of
1,300,000 and paid 195,000 uqor (0.195 QOR). Around the third, the demo sender's EVM window kept 289 transactions
left before and after, while its account sequence went from 15 to 16: the route does not use the window.

## Consequences

- "Retire now" no longer depends on the demo sender's window being open. The failure buttons still do.
- Each retirement costs 0.195 QOR at the configured gas, paid in full whatever it uses.
- The explorer link for a Native transaction uses the same `web.explorer.tx` template as an EVM one.

## How to undo

Set `nativeRoute.demoRetire` to `false` in `config/app.json` and deploy: "Retire now" goes back to an EVM transaction
through the scoped window, with no code change. To remove the route, delete `server/src/native.ts` and its test, the
`nativeRetire` option in `server/src/demo/live.ts`, `nativeSend` and the `native` option in `server/src/meter/live.ts`,
`MeterRun.send` in `scripts/src/chain.ts`, the `nativeRoute` block and its loader, and the `pqc` fields of the key
files; the web keeps reading `evmTx` answers.
