# Slides

Eight slides about Mentari, for a live demo or a quick read. Each slide from 2 to 7 answers one line the fest
judges look for and names that line in its top bar.

- **PDF:** [`mentari-slides.pdf`](mentari-slides.pdf). The text is selectable and the links work.
- **Source:** [`index.html`](index.html), with [`deck.css`](deck.css) and [`deck.js`](deck.js). Open it in a browser and
  move with the arrow keys, space or a swipe.

The PDF is `index.html` printed by headless Chromium (Playwright `page.pdf`) on a 1920 × 1080 page, one slide per page.
To change a slide, edit `index.html` and print it again.

Every number on the slides comes from the [README](../README.md) or [AI_USAGE.md](../AI_USAGE.md). A test in
`web/test/deck.test.ts` fails when the test counts on slide 6 no longer match the README. The two screenshots in
`img/` were captured from the running site over sample data, and the slides say so.

## Credits

The colours and fonts are the site's own. The fonts are under the SIL Open Font License 1.1; their licences are in
[`fonts/`](fonts/):

- [Bricolage Grotesque](https://github.com/ateliertriay/bricolage)
- [Instrument Sans](https://github.com/Instrument/instrument-sans)
- [IBM Plex Mono](https://github.com/IBM/plex)
