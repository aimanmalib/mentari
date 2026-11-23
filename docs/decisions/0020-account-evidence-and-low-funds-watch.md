# 0020. Record the accounts as evidence and watch the funds from cron

Date: 2026-11-23. Status: accepted. Builds on decision 0016.

## Context

The funder account received test QOR on 23 November 2026. `pnpm native fund` and `pnpm native keys` then topped up the
seven other accounts in one transaction and registered all eight ML-DSA-87 keys with a proof of possession. A judge
should be able to check that state without trusting our console output, and someone has to notice when the accounts
that pay for the demo run low, because the demo sender and the daily meter stop sending when gas runs out.

## Decision

- `pnpm native record` reads every account from the public REST endpoint and writes `evidence/accounts.json`: role, EVM
  and `qor1` address, balance in uqor, whether the key is registered and proven, and whether an EVM window is open.
  Public data only. `scripts/src/evidence.ts` builds the file and refuses a role with no EVM address.
- `deploy/funds.sh` runs from cron. It reads the watched roles and the line from `config/app.json` `funding`
  (`lowBalanceRoles`, `lowBalanceQor`), the addresses from `evidence/accounts.json`, and each balance from the public
  REST endpoint. It needs no key, so it can run outside the container and on any machine. It sends one warning when an
  account drops below the line and one info line when all are back, like the health watch (decision 0009). A REST
  failure changes nothing. It uses only `bash` and one `node` process with no packages, so it runs on any Node version.

## Consequences

- `evidence/accounts.json` is a snapshot. Balances drop with every transaction, so the file is written again after each
  step that matters (deploy, the recorded cases) rather than kept in step with the chain.
- The watch reads the addresses from the evidence file, so the file must exist before the cron line is added.

## How to undo

Remove the cron line, then delete `deploy/funds.sh`, `scripts/test/funds.test.ts`, `scripts/src/evidence.ts`,
`scripts/test/evidence.test.ts` and the `record` case in `scripts/native.ts`. The evidence file can stay; it is plain data.
