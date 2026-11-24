# 0039. The demo film is timed from the voice, and a copy lives in the repo

Date: 2026-11-24. Status: accepted. Follows decision 0032 (the demo video).

## Context

The first film was 103 s with hand-set picture times. The new narration has eight lines (`video/skrip.json`): the
problem, Retire now, the failure buttons, Verify, the signed meters and case I, the Native lane finding, `pnpm demo`,
and the close. A judge should see each thing at the moment the voice names it. The film also needs a place a judge
can open before a YouTube link exists.

## Decision

- `video/tangkap/teks.py` writes the film plan. Each scene has a quiet lead and tail around its narration line
  (`ADEGAN`), so the length follows from the voice. Each picture moment is a phrase in a line, timed with the
  character timings the voice engine returned. A plan outside 150 to 170 s stops the script.
- `video/index.tmpl` is the film: one page, every frame a function of time. Each screen is a capture of the live site,
  the explorer with Testnet selected, the Cross-VM docs page, or a JSON excerpt of `evidence/testnet.json`. The two
  failure buttons whose captures came from an older press are shown as cases C and D from the evidence, not as those
  captures, so no count on screen goes backwards.
- The engine renders, normalises and measures it. A compressed copy and its captions are in `docs/video/`, and both
  READMEs link it. A test checks that every file link in the README headers exists.

## Result

158.5 s, 1920x1080, -16.5 LUFS, peak -2.4 dBTP, audio and video the same length, captions burned in. The repo copy
is 1600 px wide and about 6 MB.

## How to undo

Delete `docs/video/` and the two README links (the header test then fails until the links go too). Set `ADEGAN`
back to the old timings, or check out `video/index.tmpl` and `video/tangkap/teks.py` from before this decision.
