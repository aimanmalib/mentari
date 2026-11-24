# Slides

Nine slides about Mentari, for a live demo or a quick read. Slides 2 to 7 each name one of the five official judging
criteria and its weight in the top bar, in the words of the README table. Slide 5 is the Native lane: a Native account
running the EVM contract (cases H, J and J2).

- **PDF:** [`docs/deck.pdf`](../docs/deck.pdf). The text is selectable and the links work.
- **Page:** [`index.html`](index.html), one self-contained page. Open it in a browser and move with the arrow keys,
  space or a swipe.

## How the slides are made

The slide text lives in [`kandungan.json`](kandungan.json). The judge-pack deck engine prints it to `index.html`,
`../docs/deck.pdf`, `meta.json` and `JANA.json`; those four files are generated and are not edited by hand. The engine
reads the site's design tokens (`web/src/styles/tokens.css`) and then [`tema.css`](tema.css), which names the accent
colour and embeds the fonts below. To change a slide, edit `kandungan.json`, print it again with both theme files and
commit `deck/` and `docs/deck.pdf` together. Decision record 0019 has the details.

Every number on the slides comes from the [README](../README.md) or [AI_USAGE.md](../AI_USAGE.md); the engine refuses
to print a number it cannot find there. `JANA.json` records the SHA-256 of the PDF and of `kandungan.json`, and
`web/test/deck.test.ts` fails when either no longer matches, when the test counts on slide 7 drift from the README,
or when a judging criterion in the README has no slide. The two screenshots in `img/` are taken from the public site
by `pnpm --filter @mentari/web shots`, so they show testnet data; slide 6 uses the explorer image from `docs/images/`.

## Credits

The colours and fonts are the site's own. The fonts are under the SIL Open Font License 1.1; their licences are in
[`fonts/`](fonts/):

- [Bricolage Grotesque](https://github.com/ateliertriay/bricolage)
- [Instrument Sans](https://github.com/Instrument/instrument-sans)
- [IBM Plex Mono](https://github.com/IBM/plex)
