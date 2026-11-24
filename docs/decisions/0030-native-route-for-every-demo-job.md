# 0030. Send the failure buttons and the grant from the Native lane, and report each job's real state

Date: 2026-11-24. Status: accepted. Extends decision 0026, which moved only "Retire now" to the Native lane.

## Context

The demo account's scoped EVM window expired at block 10626639 on 23 November. After that, the three failure buttons
(cases B, C, D) and the wallet grant, which were still EVM transactions, could not be sent: each press came back as a
503 and the page showed the recorded case. `/api/demo/status` still answered `"ready": true`, because it only checked
that the contracts and the key file were configured. The Try it page said live sends were open when three of the four
buttons could not send.

Decision 0026 kept the failure buttons on the EVM lane because their point is the EVM-to-Native atomicity. That
atomicity does not depend on how the EVM call is entered: a `MsgCrossVMCall` runs the same EVM call, nested bridge
call included, inside one Native transaction. Case H step 1 measured what the chain does when that EVM call reverts:
the transaction `48C756E1F0FA87228077922CF3F7B1D4501A887EEF8D9D79D67A0C0FE1E8C681` was put in block 10612980 with
code 14 in codespace `crossvm` ("execution reverted"), and the receipt count stayed at 13. A revert on the Native lane
is therefore a mined, failed transaction, as the buttons need, and not a refusal before any block.

## Decision

- `config/app.json` `nativeRoute` gains a switch per demo job: `demoCases` (cases B, C, D) and `grant`
  (`Mentari.transfer`), both on, next to `demoRetire`. Their gas limits are `caseGas` (1,500,000, the limit cases B
  to D had on the EVM lane) and `grantGas` (800,000; `transfer` makes no bridge call). The fee is the whole limit at
  the configured price.
- A Native call that fails in a codespace other than `nativeRoute.revertCodespace` (`crossvm`, measured in case H) is
  an error, not the expected revert. An out-of-gas failure must not be shown as "the contract refused".
- The demo chain reads its state in one go: sender balance, certificates held, the demo account's EVM window
  (`live`, `untilBlock`) and the lane of each job. `server/src/demo/lanes.ts` turns that into `{ ready, lane, reason }`
  per job. A job on the EVM lane is ready only while the window is live.
- Every send checks its own job first and refuses with `window-closed`, `low-funds` or `no-certificates` before using
  the visitor's quota. The status route reports `retire`, `cases` and `grant` with lane and reason, plus
  `senderBalanceQor` and `evmWindow`. `ready` is true when at least one of the four buttons can send. The chain read is
  shared for `statusCacheSeconds` (`config/limits.json`, 15 s).
- The Try it page uses the job's own readiness: a button whose job cannot send shows its recorded case without a
  request, while another button stays live. A failure case sent from the Native lane gets its own note; the note for
  "Retire now" names `Mentari.retire` and would be wrong for it.
- The wallet grant answer can carry `cosmosTx`. The page then shows the Native transaction and does not wait for an
  EVM receipt, because the server answers after the block.
- The server does not reopen the EVM window by itself. With every job on the Native lane there is nothing that needs
  it, and opening a window is an account-wide grant better done by hand with `pnpm native`.

## Consequences

- No demo button depends on the EVM window once this is deployed. The site shows the real state of each button.
- A failure press costs 0.225 QOR (1,500,000 gas at 0.15 uqor) instead of drawing on the window's EVM gas. The daily
  cap in `config/limits.json` bounds the spend; the funds watch warns below its threshold.
- The explorer labels these transactions as Native and hybrid-signed, like "Retire now".
- Pressed on the deployed site on 24 November, cases B, C and D each landed in a block with code 14 in the
  `crossvm` codespace, used 332,781 to 745,289 of the 1,500,000 gas limit, and left both ledgers unchanged. The
  hashes are runs 10 to 12 in `evidence/live.json`, and `pnpm verify` reads each one back. The grant is tested on a local node with
  a stand-in for the chain; it has not been pressed on the testnet.

## How to undo

Set `nativeRoute.demoCases` and `nativeRoute.grant` to `false` in `config/app.json` and deploy. Those jobs go back
to EVM transactions through the scoped window, and the status reports them ready only while that window is live
(open one with `pnpm native`). To remove the per-job state, revert the commit that adds `server/src/demo/lanes.ts`.
