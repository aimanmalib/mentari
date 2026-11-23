# 0028. Cover image drawn from the live site

Date: 2026-11-23. Status: accepted.

## Context

The project page on the fest site asks for a cover image. Without one the platform draws a placeholder. The cover
should show the product as it is, not a mock-up, and it should not drift from the site's colours and type.

## Decision

- `brand/mentari-cover.png` is 1920 × 1080. `web/og/render-cover.ts` draws it with headless Chromium: the name, a
  one-line tagline, and a shot of the live registry page taken in the same run.
- The shot waits until the page has finished reading both ledgers (`web.cover.shotReadySelector`), so the picture
  shows the real numbers and the "both ledgers agree" verdict, not the loading state.
- Every value lives in config or the locale files: size, byte limit, image path, page path, shot size and the ready
  selector in `config/app.json` `web.cover`; the kicker line, tagline and image alt text in `web/locales/*.json`
  `cover`. Colours and fonts come from `web/src/styles/tokens.css` and the site's own font files.
- The cover template `web/og/cover.html` shares the slot filler, the inline brand mark and the font loading with the
  link preview card (decision 0018); `web/og/assets.ts` now holds the font list both renders read.
- The image is committed, so nothing in the build or CI needs the network or a browser for it. A test checks its size
  and byte limit against `web.cover`.

## Consequences

- The numbers in the shot are a moment in time: 344,115 Wh minted, 7,500 Wh retired, 15 retirements and receipt
  #24 on the first render (2026-11-23 18:24 UTC). Redrawing later shows later numbers.
- Redrawing needs the live site up: `pnpm --filter @mentari/web cover`, then commit the image.

## How to undo

Revert the commit that added the cover. `web/og/render.ts` keeps working on its own font list again, and the project
page goes back to the platform's placeholder until another image is uploaded.
