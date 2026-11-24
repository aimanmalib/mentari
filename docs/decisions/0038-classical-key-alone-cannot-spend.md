# 0038. Case I: a classical key alone cannot spend certificates

Date: 2026-11-24. Status: accepted. Follows decision 0025 (case H, the Native route) and decision 0030 (every demo
job on the Native lane).

## Context

`Mentari.retire` and `Mentari.transfer` act for `msg.sender`. The ML-DSA-87 check in the contract covers meter
readings and key registration, not these two calls. So whoever can send an EVM transaction from an account can spend
its certificates. If a quantum attacker recovers an account's secp256k1 key from its public key, what stops them?

The answer I expected is the chain: an EVM transaction is admitted only through an EVM window, and an account opens a
window with a hybrid (secp256k1 + ML-DSA-87) signature on the Native lane. I had not measured it.

## Decision

`pnpm classic-only` (`scripts/classic-only.ts`, `scripts/src/classic-only.ts`) records case I in
`evidence/testnet.json`, once:

1. Step 1. The buyer (account 6, no EVM window) signs `Mentari.retire(500, "Case I")` as a plain EVM transaction
   with its secp256k1 key alone and sends it with `eth_sendRawTransaction`. An `eth_call` of the same call first shows
   the contract itself would accept it. The run records the node's answer, whether a receipt appears within
   `classicOnly.waitSeconds`, and the nonce, certificates and retirement count before and after.
2. Step 2. The same account sends the same `retire` as a hybrid-signed `MsgCrossVMCall`, the route the site uses.

Before step 1 the demo sender gives the buyer `classicOnly.stockWh` from the Native lane (a `transfer` through
`MsgCrossVMCall`), so a lack of certificates cannot be the reason for a refusal. The settings are in
`config/app.json` `classicOnly`.

`pnpm verify` checks case I from public endpoints: the step 1 hash still has no EVM receipt, and the step 2 Cosmos
transaction is accepted at its block with the receipts book one higher.

## Result (2026-11-24)

- Stock transfer: `672BD5188B57B41838EC0168782DC7F35FF2A5CA481A04D08295FAB4B51B3A81`.
- Step 1 `0x3c297530cadcd180945ca7ee06f292c20077b9a0b7bab683c037641c1d6ca515`: refused at broadcast. The node said the
  account "has no open EVM authorisation window; open one with MsgOpenEVMWindow, signed on the Cosmos lane with the
  account's post-quantum key". No receipt. Nonce 6 -> 6, certificates 1,000 -> 1,000, retirements 21 -> 21.
- Step 2 `97A5C80786442EC1C3866D0A890FE0E21915DB22B227F675A92F9873AE4CEA38`: accepted at block 10658815. Retirements
  21 -> 22, the buyer's certificates 1,000 -> 500, receipts 30 -> 31.
- `pnpm verify` 97 of 97.

## Limits

- The test covers an account with no window. An account that has a live window can send EVM transactions with its
  secp256k1 key until the window ends, within the window's targets, transaction count and value. That is why the
  demo sender's window was scoped and why the site no longer needs one (decision 0030).
- One run, one account, on the Diana testnet. Not mainnet.

## How to undo

Delete case I from `evidence/testnet.json` and the `classicOnly` block from `config/app.json`, and remove
`scripts/classic-only.ts`, `scripts/src/classic-only.ts` and their test. `pnpm verify` then skips the case. The
transactions stay on chain.
