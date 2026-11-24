# 0032. Build the demo video outside git, from live captures

Date: 2026-11-24. Status: accepted.

## Context

The fest asks for a video of up to three minutes. The video has to show the product, not slides about it: the live
registry, a real "Retire now", the three failure buttons, the signed meter readings and `pnpm verify`. Every number on
screen has to come from the testnet or from a test run, and the narration has to say it is an AI voice.

A rendered film is a 15 to 25 MB binary. Each new render would add another copy to the history of a public repository,
and the history cannot be rewritten after it is pushed.

## Decision

- The video workspace is `video/`, ignored by git. It holds the capture script, the narration lines, the film source,
  the rendered MP4 and a build record (`JANA.json`) with the SHA-256 of the MP4, the voice line hashes and the loudness
  measurements.
- The screens are full-page captures of the live site at `https://mentari.sasateguh.com`, taken with Playwright at
  1280 CSS px and scale 2, with real clicks: one "Retire now" and the three failure buttons, each a testnet
  transaction. The on-screen evidence panels are excerpts of `evidence/testnet.json`, and the terminal is the output of
  one real `pnpm verify` run. A small script writes these values into the film data, so no number is typed by hand.
- The narration is a clone of my own voice made with ElevenLabs, and the end card says so. The music is by Sascha
  Ende, ende.app, under CC BY 4.0, credited on the end card and in the README.
- The film is about 103 seconds, 1920x1080, normalised to between -16 and -17 LUFS with true peaks at or under
  -1.5 dBTP.
- The MP4 is published as an unlisted YouTube video by me. A copy goes on the demo site only after I have watched it.

## Consequences

- The repository does not contain the film or its sources. A reader checks the claims in the film with the same
  tools the film shows: the live site, `evidence/` and `pnpm verify`.
- The capture sends four testnet transactions from the demo account each time it runs.
- A change to the site or the evidence after the capture is not in the film until it is captured and rendered again.

## How to undo

Delete the `/video/` line from `.gitignore` and commit the workspace without the rendered MP4, or replace the film with
a plain screen recording of the same steps.
