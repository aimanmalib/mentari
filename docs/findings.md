# Findings: calling Mentari from the Native lane (case H)

Date: 2026-11-23, on the Diana testnet (`qorechain-diana`, EVM chain id 9800). Decision record: [0025](decisions/0025-native-entry-route.md).
The record is `nativeEntry` in [`evidence/testnet.json`](../evidence/testnet.json); the command is `pnpm native-entry`.

## The question

Every other transaction in this project is an EVM transaction. To send one, an account first opens an EVM
authorisation window on the Native lane, and the window has to list the contracts it may reach. I wanted to know if
the other way in works: an account signs a Native `MsgCrossVMCall` (secp256k1 plus ML-DSA-87, a hybrid signature)
whose target is the Mentari contract, with no EVM window open at all.

The Cross-VM reference in the QoreChain docs, read on 23 November, marks "Native account to EVM contract" as not yet
tested against the live network. The same page says the bridge at `0x…0901` is admitted only by an open EVM window. So
I did not know what would happen, and I ran it.

## How I ran it

- Sender: account 6, the "buyer" (`qor14yc6fymv4c9nfyxmu85xfp8wp8m4vlgp5srudw`, EVM
  `0xA931a4936cAE0B3490DBe1e86484eE09F7567d01`). It has a registered ML-DSA-87 key and has never opened an EVM window.
  `pnpm native-entry` reads the window first and sends nothing if one is live.
- I did not use the demo sender (account 7), because its window serves the live demo on the site. Closing it for the
  test would have stopped the demo.
- Each step is one `MsgCrossVMCall` with `target_vm` `evm`, the Mentari address as `target_contract`, the ABI call as
  `payload`, `async` false, and a fixed gas limit of 2,000,000 from `config/app.json` `nativeEntry`.
- Before step 2, the demo sender moved 1,000 Wh of certificates to the buyer with a normal EVM transfer through its
  own window (`0xe6a9ec050957fac05fc3ae254a9608d07ac19a2742e513eb25ed4903076883a9`).
- The script records what the chain answered, success or not, with the contract state before and after, and the
  receipts book count at the block before and at the transaction's block.

## Results

| Step | Call | Cosmos transaction | Block | Gas used | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | `attest(3, 20777, …)` | `48C756E1F0FA87228077922CF3F7B1D4501A887EEF8D9D79D67A0C0FE1E8C681` | 10612980 | 406,755 | Reached the contract and reverted there with `AlreadyAttested(3, 20777)`. Receipts 13 -> 13. |
| 2 | `retire(500, "Native entry E1")` | `8E15D319B2971FC5102C027BA8E3C8A8AAF1FDD72AD8E2172CEE2303B453B40A` | 10613003 | 1,009,253 | Accepted. Retirement 5, receipt 14. Receipts 13 -> 14. |

**Step 2 is the answer to the main question.** One Native transaction, hybrid-signed, with no EVM window:

1. the chain checked both signatures (`pqc_hybrid_verify`: `verified`);
2. it ran `Mentari.retire` in the EVM as the buyer's own `0x` address (`crossvm_request`, `source_vm` `native`,
   `target_vm` `evm`);
3. `retire` burned 500 Wh and called the bridge at `0x…0901`, which ran `record` on the `qday-receipts` contract
   (`crossvm_request`, `source_vm` `evm`, `target_vm` `cosmwasm`);
4. the receipt's sender is the Mentari contract's Native address `qor17h9jcczg5l8gckn6enrxaw80cvu59fzg2335fw`, and its
   note is `MTR1 n=5 wh=500 by=0xa931a4936cae0b3490dbe1e86484ee09f7567d01 m=Native entry E1`.

Both cross-VM messages report `executed`. Native, then EVM, then Native, in one transaction. `pnpm verify` checks this
retirement like any other, and passed 30 of 30 checks after it.

**Step 1 was sent for a day that already has a reading.** Every finished day of system 3 had one when I ran it, so I
sent a valid reading for the first day again. The call reached the contract: the chain's log is "execution reverted",
and an `eth_call` of the same call from the buyer's address names `AlreadyAttested(3, 20777)`. That shows the chain
let the call into the EVM with no window; the contract refused it. A successful `attest` from the Native lane still
has to be run once a day without a reading exists (`pnpm native-entry --again 1`).

**I ran both steps twice.** The first run (step 1 `98A6FF3FF4F1F55B23F0D89AD016FF4ABF1804F045560D424C938485B8F7A427`,
step 2 `C7542EB3BE5D99895329997499D08B2E9527644AC010AD84ABA1B0CE2E75BF01`, retirement 4, receipt 13) gave the same
answers. The script read the receipts count at a block that was not yet up to date, so I fixed that and ran again. The
second run is the one in the evidence file. Retirement 4 is still on chain, and `pnpm verify` checks it too.

## Step 3: the project page

Not done. The fest's project page for Mentari does not exist yet, so I cannot see whether the "Cross-VM, EVM to
Native" feature shows as verified.

## What this changes

Following the plan I set before the test: when step 2 is accepted, the demo sender and the meter should use this
Native route and need no EVM window. Decision 0025 records that, and what is still to do. Until it is built, the site
keeps sending through the demo sender's scoped window, which works.

## What I did not test

- An asynchronous `MsgCrossVMCall` into the EVM.
- A call through `authz` on behalf of another account.
- Whether an account with a live window that does not list Mentari is held to that window. The buyer had no window.
- Mainnet. `MsgCrossVMCall` is paused there.
