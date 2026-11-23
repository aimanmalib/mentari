# 0018. Link preview tags from config

Date: 2026-11-22. Status: accepted.

## Context

A link to the site shared in a chat app or on social media showed no picture, title or summary: the page head had a
title and a description written into `web/index.html`, and no Open Graph or X card tags. The site is one URL with
the language chosen in the browser, so the preview can only carry one language.

## Decision

- `config/app.json` `web.share` holds every preview value: site address and name, image path and size, the size limit
  for the image, the X card kind, the Apple touch icon path, and the Open Graph locale for each site language.
- The texts are `meta.title`, `meta.description` and `meta.imageAlt` in `web/locales/en.json` and `ms.json`. The
  preview uses the default locale (`web.defaultLocale`); the other locales are listed as `og:locale:alternate`.
- `web/share-meta.ts` builds the tags with a pure function and adds them with Vite's built-in `transformIndexHtml`
  hook, in `vite dev`, `vite build` and the end-to-end build alike. No package was added.
- `web/index.html` no longer carries its own title or description. The build fails when `web.share` or one of the
  three locale keys is missing, when the site address is not https, or when the page source sets its own title.
- Image addresses are absolute (`siteUrl` + `image`), since preview crawlers do not resolve relative ones. Every value
  is HTML escaped.
- The page body does not change. The browser tab title still follows the chosen language at run time.
- The preview image and the Apple touch icon are drawn by `web/og/render.ts`: it fills the template `web/og/card.html`
  with the default locale's title and description, the colours from `web/src/styles/tokens.css`, the brand mark
  `brand/logo.svg` and the site's own fonts, and captures it with the Playwright Chromium the repository already uses
  for the slides. The touch icon is the brand mark without its rounded corners, at `web.share.appleTouchIconSize`.
- Both images are committed under `web/public/`, so building the site needs no browser. The render stops when the
  image is over `web.share.imageMaxKb`; a test checks both sizes and the byte limit against `web.share`.

## Consequences

- Changing the preview title, description, colours or brand mark means running `pnpm --filter @mentari/web og`
  again and committing the two images. Text and contrast were checked on the first render: 9.6:1 for the title and
  description on the blue ground.
- Changing the preview wording means editing the locale files; changing the address or image means editing
  `config/app.json`. Both need a rebuild.
- Checked on the live site after the deploy of 2026-11-23: the page head carries the 12 Open Graph tags, the 5 X card
  tags and the Apple touch icon link; the page and `/og.png` answer 200 (`text/html`, `image/png`, 54 125 bytes) to the
  WhatsApp and Telegram crawler user agents; a full-page screenshot before and after the deploy differs by 0 pixels.

## How to undo

Revert the commit that added the two images to drop them; the tags then point to addresses that answer 404 and
previews show text only. Revert the commit that added `web/share-meta.ts`: `web/vite.config.ts` stops calling it, and
the title and description go back into `web/index.html`. Redeploying the previous container image restores the old
page head.
