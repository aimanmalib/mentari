# 0035. The home page tells the story and offers one action

Date: 2026-11-24. Status: accepted.

## Context

The home page was the registry board: a title, the two ledgers and the meter table. It had no action on the first
screen, no picture of the product, and nothing about how a retirement works or what is simulated. A visitor had to find
Try it and How it works on their own. The wallet panel on Try it did not say that QoreX cannot sign its last step yet,
except in a note under the title.

## Decision

- The home page (`web/src/pages/Registry.tsx`) now runs in this order: hero, live proof, three steps, the solar
  systems table, questions.
- The hero has one action, "Retire 500 Wh now" (the amount from `config/limits.json` `demo.retireWh`). It is a button,
  not a link. It opens Try it and asks that page to press Retire now once. The request rides in `history.state`
  (`web/src/data/pressOnOpen.ts`), never in the URL, so a crawler or a shared link cannot send a testnet transaction.
  Try it reads the request once, clears it, and presses after the demo status is known. A reload does not press again.
- Next to the text is the cover art (`brand/mentari-cover.png`, bundled at build time from its copy
  `web.cover.webCopy`, because `brand/` is not in the Docker build context) in a panel frame. When
  `config/app.json` `web.links.video` holds a link, the picture opens that video with a "Watch the demo video" button.
  While it is empty the picture is a still and the page claims no video.
- Live proof keeps the two ledgers and adds the newest retirement with a link to the Native transaction that wrote its
  receipt (`/go/receipt/<id>`, decision 0034) and the explorer note.
- Five questions answer what is simulated, that it is testnet only, that there is no audit, where post-quantum signing
  is used and what a failure does. The list of questions is `config/app.json` `web.home.faq`; the text is in
  `web/locales` (`home.faq.<id>`), English and Bahasa Melayu.
- The wallet panel on Try it carries a "Preview: QoreX cannot sign this step yet" tag above its title. It already sits
  below the demo buttons.
- No animated `filter` or `backdrop-filter` (WebKit on iPhone crashes on them). The only motion is the question marker
  turning when a question opens.

## Checks

`web/test/home.test.tsx`: one button and no link that retires, the framed picture with alt text in both languages,
video link only when configured, three steps in order, every configured question answered in both languages, the
receipt link, and the one-time press request. `web/e2e/home.e2e.ts` (Chromium and WebKit iPhone 13): the action is on
the first screen, at least four section headings and one image, no sideways scroll, one POST to `/api/demo/retire`
after the press, none after a reload.

## How to undo

Revert the commit. `Registry.tsx` goes back to the board, the hero and story components and `home.css` go away, and
`navigate` drops its `state` option. `web.home` and `web.links.video` in config can stay; nothing else reads them.
