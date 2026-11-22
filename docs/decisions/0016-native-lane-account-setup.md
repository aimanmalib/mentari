# 0016. One command gets the accounts ready on the Native lane

Date: 2026-11-22. Status: accepted. Builds on decisions 0002 and 0015.

## Context

On QoreChain an EVM transaction is admitted only from an account that has a registered ML-DSA-87 key and a live EVM
authorization window, and the window is opened by a hybrid-signed Native transaction. `pnpm testnet` (decision 0015)
deploys and attests, but it assumes all of that is already in place: the accounts funded from the one funded account,
every key registered, and an unscoped window open for the deployer (a scoped window refuses contract creation).
Done by hand, that is about a dozen Native transactions in a fixed order, where a mistake costs fees or locks an
account (a second key registration is refused after the fee is charged).

Our accounts are unified eth-native accounts: one secp256k1 key with Ethereum address derivation. cosmjs's standard
signer derives the address the Cosmos way, so it cannot sign for them.

## Decision

- `scripts/src/lane.ts` reads and writes the Native lane over the public REST endpoint only: account number and
  sequence, the uqor balance, the key status (`fetchPqcStatus`), the window (`fetchEvmWindow`), and broadcasting signed
  bytes in sync mode, then waiting until the transaction is in a block. A refusal or a failed transaction throws with
  the chain's code and log. No key passes through it.
- `scripts/src/native.ts` holds the steps. Each reads the chain first and sends only what is missing:
  - `fundAccounts` tops each account up to its target in `funding.targetsQor` with one transaction of bank sends from
    the funder. It refuses before sending anything when the funder would end below `funding.keepOnFunderQor`, the part
    kept for deploy gas and for the second project. It registers the funder's key first, because every transaction
    after the registration is signed hybrid.
  - `registerKey` registers the account's key with `MsgRegisterPQCKeyV2`, a proof of possession bound to this account
    and chain id, and the account's compressed secp256k1 key (checked with `validateClassicalKeyForSender`). It is the
    only transaction signed classically. When a key is already registered it compares it with ours and stops on a
    different one. After registering it reads the status back and fails unless the key is registered and proven.
  - `openWindow` opens the window named in `windows` (role, blocks, transactions, value in QOR). It keeps a live window
    that has no scope and at least the transactions and value asked for, and opens a new one over a scoped window.
    `closeWindow` closes a live window.
  - `actorFrom` signs for a unified account with the SDK's `EthNativeSigner` (hybrid, or classical for the
    registration), with the sign-bytes form resolved once from the network.
- `scripts/native.ts` (`pnpm native status | fund | keys | window <name> | close <role>`) acts for the funder and every
  role with a funding target, and prints roles, addresses, amounts and hashes only. `cd scripts && npx tsx native.ts
  status` exits 3 when an account in `funding.lowBalanceRoles` is below `funding.lowBalanceQor`, so a scheduler can alert
  on it (`pnpm` turns any failure into exit 1).
- Gas limits are fixed per message kind in `nativeLane.gas`, about twice what the same messages used on the testnet
  (an eth-native `MsgOpenEVMWindow` used 190,806 to 191,540 gas at heights 10,543,944 to 10,544,231, a `MsgRegisterPQCKeyV2` about
  278,400), at the price in `nativeLane.gasPriceUqor`. That is a fee of under 0.1 QOR per message and needs no
  simulation of a hybrid transaction before it is signed.

## Consequences

- With funds on the funder, the order before `pnpm testnet` is `fund`, `keys`, `window deploy`. After the deploy,
  `close "funder and deployer"` removes the unscoped window, as the plan for windows asks.
- The steps are tested against an in-memory lane that refuses a hybrid transaction from an account with no key and a
  classical transaction that is not a key registration. The REST reader is tested with a fake `fetch`. The signer is
  tested offline with the SDK. The first real run is on the testnet; what differs there gets its own decision.
- A window on the testnet lasts at most 17,280 blocks (about five hours). The server's daily meter run and the demo
  sender send EVM transactions too, so they will need a window of their own each time, or the Native path tested in
  the E1 experiment. That choice is made after the experiment, not here.

## How to undo

Delete `scripts/native.ts`, `scripts/src/native.ts` and `scripts/src/lane.ts` with their tests, the `native` script in
both `package.json` files, and the `nativeLane`, `funding` and `windows` blocks of `config/app.json`. The same
transactions can then be sent by hand with the SDK.
