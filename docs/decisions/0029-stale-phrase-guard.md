# 0029. A test that fails on text the testnet has already made false

Date: 2026-11-24. Status: accepted.

## Context

Several lines were written before the contracts were on testnet: "No retirements yet", "after deployment", "Tested
against the bridge mock", "over sample data", "28 of 28". The testnet now holds 16 retirements, and `pnpm verify`
passed 67 of 67 checks. A judge who reads one of those lines and then sees the live site has to guess which one is
true. The README screenshots and the slide images were also taken from the local fixture, not the live site.

## Decision

- `config/stale-phrases.json` lists the phrases, the files and folders to scan, and what to skip. Decision records and
  `CHANGELOG.md` are skipped because they are history.
- `web/test/stale-phrases.test.ts` fails when a scanned file holds one of the phrases while `evidence/testnet.json` or
  `evidence/live.json` records a retirement that added a receipt. It reads the files from disk, not from git, so it
  works in a clean `git archive` copy.
- The READMEs, `AI_USAGE.md`, the site text in both languages and `deck/kandungan.json` were rewritten from
  `evidence/`. Fixture mode stays for local work; its notice now says it is a local fixture.
- `web/og/render-shots.ts` takes the README and slide screenshots from the public site. The list (page, ready selector,
  output file, device or size, byte limit) is `config/app.json` `web.shots`. A test checks the list and the sizes of the
  committed images.

## Consequences

- Adding a new "not yet" sentence to a scanned file turns CI red until the sentence is true or reworded.
- A phrase that is right in a new context needs either a reword or a narrower phrase in the config, not a skip of the
  whole file.
- Redrawing the screenshots needs the live site up: `pnpm --filter @mentari/web shots`, then commit the images.

## How to undo

Delete `config/stale-phrases.json` and `web/test/stale-phrases.test.ts`. Remove `web.shots` from `config/app.json`,
`web/og/render-shots.ts`, `web/og/shots.ts`, `web/test/shots.test.ts` and the `shots` script in `web/package.json`.
The rewritten text can stay.
