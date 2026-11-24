# 0041. Cases J and J2: a bank transfer and a retire in one Native transaction

Date: 2026-11-24. Status: accepted. Follows decision 0025 (case H, the Native route) and decision 0038 (case I).

## Context

Every Native transaction Mentari sends carries one message. A Cosmos transaction can carry several, and the chain runs
them all or none. I wanted to know whether that still holds when one of the messages is a `MsgCrossVMCall` into an
EVM contract that itself calls the bridge: can a bank balance on the Native side and the contract's state on the EVM
side change in the same transaction, and does a revert inside the EVM call undo a bank transfer that already ran?
No new contract is needed for this, and the deployed contracts are not touched.

## Decision

`pnpm bank-fee` (`scripts/bank-fee.ts`, `scripts/src/bank-fee.ts`) records two cases in `evidence/testnet.json`,
once. Each is one hybrid-signed (secp256k1 + ML-DSA-87) transaction from the buyer (account 6, no EVM window) with
two messages, in this order:

1. `MsgSend` of the retirement fee (`bankFee.feeUqor`, 0.1 QOR) to the registrar (account 1).
2. `MsgCrossVMCall` into `Mentari.retire`.

- Case J retires `bankFee.retireWh` (500 Wh), which the buyer holds.
- Case J2 asks to retire one Wh more than the buyer holds right after J, so the contract reverts with
  `InsufficientBalance`.

The fee goes first on purpose. If the `MsgSend` came after the call, a failed call would stop the transaction before
the transfer ran, and J2 would prove nothing. With the transfer first, J2 shows a transfer that ran being undone.

The registrar is the recipient because no recurring job sends to it, so its balance in that block moves only by
this fee. The run reads its balance at the block before the transaction and at the transaction's block.

`pnpm verify` checks both cases from public endpoints: the Cosmos transaction has the recorded outcome at its block,
it carries `MsgSend` then `MsgCrossVMCall`, the receipts book moved by one (J) or not at all (J2), and the
registrar's balance rose by the fee (J) or stayed the same (J2) between the two blocks.

## Result (2026-11-24)

- Case J `C1503B00FEB65516D85DBC8832F32A3FD99625F807D4CEBB9A2B1BF0FB4B2527`, block 10666328, code 0, gas used
  1,022,998. Registrar 6,000,000 -> 6,100,000 uqor. Receipts 32 -> 33, retirements 23 -> 24, the buyer's
  certificates 500 -> 0.
- Case J2 `3E2F2D8D3E0386F2162D0AE1EC49FBABDEFEDEE29202D480D70FC5557BF7E3AD`, block 10666332, code 14 (`crossvm`),
  "message index: 1: execution reverted", `InsufficientBalance(0, 1)` from an `eth_call` of the same call. Registrar
  6,100,000 -> 6,100,000 uqor. Receipts 33 -> 33, retirements 24 -> 24. The buyer still paid the gas fee: the
  `transfer` event of J2 is the fee, not the `MsgSend`.
- `pnpm verify` 107 of 107. With the recorded fee, the J2 outcome or the message list changed in a copy of the
  evidence, the three new checks fail.

## Limits

- One run of each case, one account, on the Diana testnet. Not mainnet.
- The site does not send this transaction. "Retire now" stays one message, and there is no fee on the site.

## How to undo

Delete cases J and J2 from `evidence/testnet.json` and the `bankFee` block from `config/app.json`, and remove
`scripts/bank-fee.ts`, `scripts/src/bank-fee.ts`, their test, the `leading` option of `runStep` in
`scripts/src/native-entry.ts` and the `bankChecks` call in `scripts/verify.ts`. `pnpm verify` then skips the cases.
The transactions stay on chain.
