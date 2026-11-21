# 0002. Test accounts and where the phrase lives

- Status: accepted
- Date: 2026-11-21

## Context

Mentari sends testnet transactions from several roles: a funder that also deploys, a registrar, three simulated meters, a
producer, a buyer and the live demo sender. Each role needs its own address so the evidence shows who did what. The repository
will be public, so no phrase or key may ever be tracked, printed or logged.

## Decision

- **One BIP-39 phrase (24 words)** for every testnet account. Accounts are derived with `deriveUnifiedAccount(phrase, index)` from
  `@qorechain/sdk` 0.14.0 (HD path `m/44'/60'/0'/0/{index}`, ML-DSA-87 key derived from the same phrase). The indices and their
  roles live in `config/app.json` under `accounts`: 0 funder and deployer, 1 registrar, 2 to 4 meters A to C, 5 producer, 6 buyer,
  7 demo sender. Indices 10 and 11 are reserved for a second project that shares the funding account; nothing else is derived.
- **The phrase lives in one file outside the repository**, named by the `MENTARI_ACCOUNTS` environment variable (see
  `.env.example`). `pnpm keys` creates it on first run with mode 600 inside a mode 700 folder, using an exclusive create so a
  second run can never replace an existing phrase. It refuses a relative path, a path inside the repository and a file that group
  or others can read.
- **Scripts print public data only**: index, `qor1…` address, `0x…` address, role and, with `--balances`, the EVM balance read
  from the public RPC. Tests check that the derived output has no secret fields.
- **The demo server gets only account 7's key**, from a read-only file mounted at run time, never from the image (decided again
  when the server is deployed).
- Testnet only (`qorechain-diana`, EVM chain id 9800). No mainnet, no tokens of value.

## Consequences

- One person funds one address (account 0) and the scripts spread test QOR to the other roles.
- Losing the file loses the testnet accounts. Contracts already deployed stay readable, but new transactions would come from new
  addresses and the registry would need a fresh deployment.

## How to undo

Point `MENTARI_ACCOUNTS` at a new file and run `pnpm keys` to create a fresh phrase, then fund the new account 0. To move to one
phrase per role, replace `publicAccounts` with a per-role loader; `config/app.json` already names every role.
