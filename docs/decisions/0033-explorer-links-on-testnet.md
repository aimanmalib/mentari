# 0033. Send explorer links through the Cosmos hash and tell visitors to pick testnet

Date: 2026-11-24. Status: accepted. Follows decision 0008, which added the explorer links, and decision 0023, which
found why they did not work.

## Context

Every transaction link on the site opened the public explorer and showed "Transaction not found". I opened the links
in a browser on 2026-11-24 and found two causes:

- The explorer picks its network from its own `qore-network` cookie and opens on mainnet. There is no URL parameter
  for the network (`?network=testnet` changes nothing). A link from another site cannot set that cookie. With the
  cookie on testnet, the same URL shows the transaction. Pressing "Testnet" in the explorer's header sets it and keeps
  the URL, so the record shows at once.
- The explorer's `/tx/` page takes the Cosmos transaction hash. An EVM hash (`0x…`) fails with
  `encoding/hex: invalid byte: U+0078 'x'`, on both networks. The Retirements page only knows the EVM hash from the
  `Retired` event, and so does the wallet path.

The Native REST API indexes every EVM transaction by its hash: `GET /cosmos/tx/v1beta1/txs?query=
ethereum_tx.ethereumTxHash='0x…'` returned the Cosmos transaction for case A (`0x08e96e38…` is `5654336F…`, block
10609362) and for two retirements, and an empty list for an unknown hash.

## Decision

- The server answers `GET /go/tx/<hash>`. A Cosmos hash is redirected straight to the explorer. An EVM hash is looked
  up with the query above through the existing `/lcd` cache and fixed REST origin, then redirected to the Cosmos hash
  that carried it. No match is a 404, a REST failure is a 502. The redirect may be cached by the browser
  (`config/limits.json` `explorer.redirectCacheSeconds`): a hash never moves to another transaction.
- The site sends an EVM hash to `config/app.json` `web.explorer.evmTx` (`/go/tx/{hash}`) and a Cosmos hash straight to
  `web.explorer.tx`. A recorded case links its `cosmos_tx` directly when it has one. The server refuses to start if
  `evmTx` is not its own route.
- One line next to the links, in English and Malay, says the explorer opens on mainnet and to press Testnet at the
  top of its page. It is on the Retirements page, under a Verify result and under a Try it result.
- The `/lcd` allowlist does not grow: the lookup URL is built on the server from one fixed shape, so visitors cannot
  send their own queries through it.

## Consequences

- A judge who presses Testnet once sees every linked record. Block and address links already worked on testnet.
- Each first click on an EVM link costs one REST query; repeats come from the browser cache or the 5 s `/lcd` cache.
- If the explorer adds a network parameter later, only `web.explorer.tx` changes and the note can go.

## How to undo

Revert the commit. The links go back to `web.explorer.tx` with the hash as given, and `/go/tx/` falls through to the
page shell again.
