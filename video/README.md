# Demo film

What the demo film says, and the material it is cut from. The film itself and its screenshots are not in git.

- [`skrip.json`](skrip.json): the eight narration lines, as spoken and as captioned. `sebut` says how the voice
  reads a term.
- [`tangkap/tangkap.e2e.ts`](tangkap/tangkap.e2e.ts): the capture. It opens the live site, presses "Retire now" and
  "Write, then revert" once each, opens Verify for that retirement, the Cross-VM reference page, and the three
  transactions on the public explorer with Testnet selected.
- [`tangkap/log.json`](tangkap/log.json): what each press returned and what each explorer page said, for example
  `failed (code 14)` for the revert. [`tangkap/kotak.json`](tangkap/kotak.json) holds the element positions the
  camera moves to.
- [`index.tmpl`](index.tmpl): the film itself, one page where every frame is a function of time. Every screen in it is a
  capture of the live site or the explorer.
- [`tangkap/teks.py`](tangkap/teks.py): writes the film plan. It reads the values on screen from the evidence, the press
  log and `verify.txt`, and times each picture to the words that describe it, from the timings the voice engine returned.
- [`tangkap/verify.txt`](tangkap/verify.txt): the check lines of a real `pnpm demo` run from a clean copy of the
  repo, shown in the terminal scene.

Run the capture from the repo root. It uses 2 of the presses per hour the site allows one address
(`demo.perIpPerHour` in [`config/limits.json`](../config/limits.json)):

```sh
pnpm exec playwright test -c video/tangkap/tangkap.config.ts
```

Add `-g explorer` to capture the explorer pages again without pressing anything.

The meters are simulated. The narration is an AI clone of my own voice (ElevenLabs).
