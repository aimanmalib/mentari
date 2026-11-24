# 0042. The wallet path retires through the Native lane

Date: 2026-11-24. Status: accepted. Replaces the last step of [0010](0010-qorex-wallet-path.md).

## Context

[0010](0010-qorex-wallet-path.md) built "Retire from your own wallet" on the EVM lane: the page asked QoreX to sign
an EVM `retire` transaction. QoreX does not sign EVM transactions yet, so with the real wallet that last step was
always refused, and the panel carried a "Preview" tag.

QoreX does sign Native transactions today. `window.qorex.native` declares the `signAndBroadcast` capability: the page
hands it protobuf-encoded messages, QoreX shows them, adds the hybrid secp256k1 + ML-DSA-87 signature and broadcasts.
The kit `@qorechain/qorex-types` 0.1.0 wraps this as `qorexSignAndBroadcast`. "Retire now" already proved that a
`MsgCrossVMCall` into `Mentari.retire` runs from the Native lane with no EVM window
([0026](0026-native-route-for-retire-now.md)).

Two facts from the wallet mock, which follows QoreX's behaviour:

- QoreX derives its Native account and its EVM account from different paths. They are two accounts, not two encodings
  of one. A Native call into an EVM contract runs with `msg.sender` = the EVM form of the Native signer's bytes.
- QoreX registers the account's ML-DSA-87 key itself, in its own transaction, before the first transaction it sends.

## Decision

- When QoreX declares `signAndBroadcast`, the panel uses the Native account. It reads the account with
  `native.getKey`, shows it and its EVM form, asks the demo account to send certificates to that EVM form, and retires
  with one `MsgCrossVMCall` (`Mentari.retire(500, "from QoreX")`, gas `nativeRoute.retireGas`) signed in QoreX.
- The page simulates the call first, so a contract error is explained before the wallet is asked. After the block,
  it reads `retirement(n)` and links the retirement only when its holder is this account.
- An account with no ML-DSA-87 key gets a "Register my key" step: a send of `web.wallet.keySetupUqor` (1 uqor) to
  itself. QoreX registers the key before it. An account the chain has never seen is told to use the faucet.
- The two messages are encoded in the page (`web/src/wallet/nativeMsgs.ts`), not with `@qorechain/sdk`, to keep the
  SDK out of the site bundle. A scripts test checks the bytes against the SDK's encoders.
- A QoreX without `signAndBroadcast` keeps the old EVM path and its honest refusal.
- `pnpm wallet-run` runs the same path on the testnet with the wallet mock's `current` profile on its own account of
  the shared seed (`walletRun.accountIndex`) and the live site's grant endpoint, and writes `evidence/wallet-native.json`.

## Consequences

- The "Preview: QoreX cannot sign this step yet" tag is gone. The tag now names the lane.
- On 24 November 2026 `pnpm wallet-run` sent the key step (`77629494…`, with the mock's key registration just before
  it), got 500 Wh from the live site (`142E4C32…`) and retired them (`741D7DFC…`, retirement 25, Native receipt 34).
  Both wallet transactions carry the `PQCHybridSignature` extension.
- I have not run it with the real QoreX extension. The signer was the wallet mock, whose `current` profile is
  published as what QoreX does today.
- A judge's wallet needs testnet QOR for the fees: about 0.12 QOR for the key step (the registration and the send,
  400,000 gas each at 0.15 uqor per gas) and about 0.2 QOR for the retire.

## How to undo

Make `nativeSender()` in `web/src/wallet/useWalletActions.ts` return `null`: the panel goes back to the EVM path of
0010. Restore the old `wallet.preview` and `wallet.honest` texts in both locale files.
