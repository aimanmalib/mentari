# 0001. Repository layout and licence

- Status: accepted
- Date: 2026-11-21

## Context

Mentari is one entry for Build Before Q-Day: The QoreChain Developer Fest, Cross-VM category. The event rules ask for a public
GitHub repository with a README, and for code under the MIT or Apache-2.0 licence with the licence file in the repository. The
repository starts private and becomes public with its full history, so every commit has to be fit to publish.

## Decision

- **Licence: Apache-2.0**, full text in `LICENSE`. The QoreChain workshop examples we follow
  (`qorechain/build-before-qday`, `workshop-2/01-qday-vault` and `workshop-3/02-cross-vm`) are Apache-2.0 too, so adapted code
  keeps the same terms. `NOTICE` credits them. Files adapted from them say so in a header comment.
- **One repository, one project.** The layout is:

  ```
  contracts/   Foundry project: src/ (Mentari, AtomicityProbe, lib/), test/ (unit, fuzz, invariant, mocks)
  scripts/     TypeScript scripts run with tsx: keys, window, deploy, meter, cases, verify, status
  server/      Node server: static site, read-only /lcd proxy, rate-limited demo sender, meter scheduler
  web/         Vite + React site; all UI text in web/locales/en.json and web/locales/ms.json
  config/      app.json, meter.json, limits.json: every value that may change lives here, not in code
  evidence/    testnet.json and verify output: every number in public text comes from here or from test output
  docs/        decisions/ (these records), threat-model.md, findings.md, architecture.md
  ```

- **pnpm workspace** for `scripts/`, `server/` and `web/`, with exact package versions. Foundry for `contracts/`.
- **Tracked text is English.** The only exceptions are `web/locales/ms.json` and `README.ms.md`.
- **Internal notes are never tracked.** Planning notes, local state and keys stay out of git through `.gitignore`.

## Consequences

- Anyone can fork and reuse the code under Apache-2.0, with the NOTICE credits kept.
- Adding a new top-level folder needs a new decision record.

## How to undo

Relicensing to MIT is possible while we are the only copyright holders of the new code, but the adapted workshop code stays
Apache-2.0 and keeps its NOTICE entry. To change the layout, move the folders and record a new decision that supersedes this one.
