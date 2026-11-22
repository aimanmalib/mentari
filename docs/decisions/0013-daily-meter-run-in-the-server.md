# 0013. The daily meter run lives in the server

Date: 2026-11-22. Status: accepted.

## Context

After the backfill, each simulated system needs one signed reading per finished day, so the registry keeps growing
while judges look at it. Something has to send those readings every day, and keep doing it after a restart or a failed
call. The project already runs one long-lived process, the server in the demo container. A second scheduler outside it
would be one more thing to deploy, watch and remove after the event.

## Decision

- `server/src/meter/daily.ts` holds `DailyMeter`. It runs a job once when the server starts, then every day at the UTC
  time in `config/meter.json` (`daily.runAtUtc`, now 00:20). The run at start catches up a day missed while the
  container was down.
- The job is injected (`DailyJob`: `ready()` and `run()`). The live job will call `attestDays` from the chain driver
  (decision 0012) with a window of 1. That driver reads the chain before it sends, so a second run on the same day
  sends nothing.
- One run at a time. A failed run is tried again after `daily.retryMinutes` (now 30), but never later than the next
  daily run. `daily.enabled` switches the run off without a code change.
- Until the contracts are on the testnet and the meter keys are mounted, the server uses `unconfiguredMeter`, so the run
  stays off and the log says why.
- The log is one line per run: how many readings were sent or the first line of the error, and the next time. No keys.
- Tests use a fake clock and a fake job. They cover the time parsing, the next run time across days and years, the run
  at start, two daily runs, a retry, the retry cap, no overlap, a run that ends after `stop()`, and the off states.

## Consequences

- The meter keys must reach the container the same way as the demo sender key: a read-only folder outside the image.
- If the server is down at the daily time, the day is attested when it comes back, as long as it is back within the
  backfill window the job uses.

## How to undo

Set `daily.enabled` to `false` in `config/meter.json` to stop the run. To remove it, delete `server/src/meter/`,
`server/test/meter-daily.test.ts`, the `daily` block in `config/meter.json` and its loader in `server/src/config.ts`,
and send daily readings with the scripts instead.
