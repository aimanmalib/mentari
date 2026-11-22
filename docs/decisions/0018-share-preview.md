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

## Consequences

- The preview image and the Apple touch icon are separate files in `web/public/`; until they exist the tags point to
  addresses that answer 404 and previews show text only.
- Changing the preview wording means editing the locale files; changing the address or image means editing
  `config/app.json`. Both need a rebuild.

## How to undo

Revert the commit that added `web/share-meta.ts`: `web/vite.config.ts` stops calling it, and the title and
description go back into `web/index.html`. Redeploying the previous image restores the old page head.
