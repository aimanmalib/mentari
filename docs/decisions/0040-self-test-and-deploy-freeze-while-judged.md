# 0040. Self-test the live demo and freeze deploys while the entry is judged

Date: 2026-11-24. Status: accepted. Builds on decisions 0009, 0020 and 0030.

## Context

Judges may open the demo at any time from 3 to 16 December. Two watches already run from cron: `deploy/uptime.sh`
(the page and `/healthz` answer) and `deploy/funds.sh` (funder and demo sender above 8 QOR). Neither notices a page
that answers 200 but whose buttons would fail, a status route that says ready when it should not (the failure decision
0030 fixed), or a record that no longer reads back from the chain. 8 QOR is also late for the demo sender: a press costs
about 0.2 QOR, so a busy judging day can drain the gap before anyone acts. After submission the entry is judged as
sent, so a deploy then must be a deliberate exception.

## Decision

- `deploy/selftest.sh` runs from cron every 6 hours, needs no key, and checks three things:
  1. `GET /api/demo/status` is honest (`deploy/selftest-read.mjs` lists the rules): `enabled` matches the config, a
     ready job has a lane and no reason, a job that is not ready names one, top-level `ready` matches the jobs, Retire
     now is ready, `senderBalanceQor` matches the public REST balance, nothing is ready below the demo minimum, and
     nothing on the EVM-window lane is ready after the window's last block. A failed read is retried before it counts.
  2. The demo sender and funder balances from the public REST endpoint.
  3. The full public `verify` (about 20 seconds).
- One warning after `selftest.failsBeforeAlert` (2) failed runs in a row, one info line on recovery. The demo sender below
  `funds.warnQor` (20) warns once at the first run, since a balance does not blip. All values are in `config/limits.json`.
- Cron runs with `PATH=/usr/bin:/bin`, where `node` is version 18. The script takes `MENTARI_NODE_BIN` from
  `deploy/hos.env` or the newest Node under `~/.nvm`, checks the version is 22 or newer, and fails loudly otherwise.
- `deploy/deploy.sh` refuses a new deploy from `deploy.freezeAfter` (2026-12-02T17:59:00Z) on, before it reads any host
  file. `MENTARI_JURI_MINTA='<what the judges asked>'` lets one through. `--rollback` and `--status` stay open, because
  going back to the previous image is how a broken demo is repaired while judges look at it.

## Consequences

- Each run reads the chain about 100 times through public endpoints, four times a day. That is light for the testnet.
- `deploy/funds.sh` keeps its lower line for the funder; the two warnings say different things and do not repeat.
- The cron line carries a date guard and stops after 2026-12-22.

## How to undo

Remove the cron line, then delete `deploy/selftest.sh`, `deploy/selftest-read.mjs`, `scripts/test/selftest.test.ts`,
the `funds` and `selftest` blocks of `config/limits.json`, and `deploy/.selftest-state`. For the freeze, delete the
`deploy` block, the freeze lines at the top of `deploy/deploy.sh` and `scripts/test/deploy-freeze.test.ts`.
