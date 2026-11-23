# Slides

Eight slides about Mentari, for a live demo or a quick read. Each slide from 2 to 7 answers one line the fest
judges look for and names that line in its top bar.

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
`web/test/deck.test.ts` fails when either no longer matches or when the test counts on slide 6 drift from the README.
The two screenshots in `img/` were captured from the running site over sample data, and the slides say so.

## Credits

The colours and fonts are the site's own. The fonts are under the SIL Open Font License 1.1; their licences are in
[`fonts/`](fonts/):

- [Bricolage Grotesque](https://github.com/ateliertriay/bricolage)
- [Instrument Sans](https://github.com/Instrument/instrument-sans)
- [IBM Plex Mono](https://github.com/IBM/plex)
