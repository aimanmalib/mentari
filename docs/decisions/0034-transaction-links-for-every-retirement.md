# 0034. Find transaction links within the node's log limit, and link Native-lane retirements through their receipt

Date: 2026-11-24. Status: accepted. Follows decision 0033, which sends transaction links through the Cosmos hash.

## Context

After decision 0033 the Retirements page still showed no transaction link on any row, and neither did Verify. Two
causes, both measured on 2026-11-24:

- The site asked `eth_getLogs` for every `Retired` event from the deploy block (10606924) to the newest block, about
  37,000 blocks. The public testnet node answers `-32000 maximum [from, to] blocks distance: 10000` for any range
  wider than 10,000 blocks. A range of exactly 10,000 is accepted. The error was swallowed and every row showed
  "No EVM transaction found".
- Searching the whole range in 10,000-block steps found 3 `Retired` logs (retirements 1 to 3) out of 17. The other 14
  were sent from the Native lane as `MsgCrossVMCall`. The node does not index EVM logs from those calls, so no EVM hash
  exists to link. Each of them still has a receipt in the receipts book, and the book's `record` call emits a `wasm`
  event with the receipt `id`. `GET /cosmos/tx/v1beta1/txs?query=wasm._contract_address='<book>' AND
  wasm.action='record' AND wasm.id='14'` returned the transaction for retirement 5 (`8E15D319…`, block 10613003), and
  an empty list for an id that does not exist.

## Decision

- `retiredTxs` walks back from the newest block in windows of `config/limits.json` `evm.logWindowBlocks` (10000, so a
  request spans 9,999), makes at most `evm.logMaxWindows` requests, and stops as soon as every wanted retirement is found
  or the deploy block is reached. Newest retirements cost one request.
- The server answers `GET /go/receipt/<id>`: it runs the query above for the configured receipts book through the
  existing `/lcd` cache and redirects to the explorer page of that Cosmos transaction. Only a plain u64 id is accepted;
  the query is built on the server, so the `/lcd` allowlist does not grow. No match is a 404, a REST failure a 502.
- Every receipt on the site shows a "Transaction" link to `config/app.json` `web.explorer.receiptTx`
  (`/go/receipt/{id}`). The server refuses to start if that is not its own route. A row without an EVM transaction says
  it was sent from the Native ledger and that its transaction is linked under the receipt.

## Consequences

- Every retirement now has a working transaction link, whichever lane sent it.
- An old retirement costs one request per 10,000 blocks since it was made. With `logMaxWindows` at 60 the search covers
  600,000 blocks; a retirement older than that loses only its EVM link, and its receipt link still works.
- If the node raises or lowers its limit, only `evm.logWindowBlocks` changes.

## How to undo

Revert the commits. The search goes back to one range (which fails on the public node), and receipts lose their
transaction link; `/go/receipt/` falls through to the page shell again.
