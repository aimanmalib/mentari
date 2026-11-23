# 0019. Slides generated from one content file

Date: 2026-11-23. Status: accepted.

## Context

The eight judge slides were written by hand: `deck/index.html` with its own `deck.css` and `deck.js`, printed to a PDF in
`deck/`. Changing a number meant editing HTML and printing again by hand, and nothing showed whether
the committed PDF matched the source. The fest submission check now expects slides made by the judge-pack deck engine,
which records what it printed.

## Decision

- The slide text lives in `deck/kandungan.json`: the title, the event label, the source files and eight slides, each
  with its judging line (`kriteria`), points, an optional screenshot from `deck/img/` and footer lines. Text and order
  are the hand deck's; the three tables became short point lists, because the engine has no table layout.
- The deck engine prints it to `deck/index.html` (one self-contained page), `docs/deck.pdf`, `deck/meta.json` and
  `deck/JANA.json`. These four are generated and never edited by hand.
- Colours and fonts are the site's own: the engine reads `web/src/styles/tokens.css` and then `deck/tema.css`, which
  only names the accent (`--silicon`), gives the rule colour, and points `@font-face` at the OFL fonts in `deck/fonts/`.
- Every number on a slide must appear in `README.md` or `AI_USAGE.md`, or the engine refuses to print.
- `deck/JANA.json` records the SHA-256 of the PDF and of `kandungan.json`. `web/test/deck.test.ts` fails when either
  file no longer matches its hash (an edit that was not printed again) and when the test-count tiles drift from the
  README table.
- The site footer and both READMEs link `docs/deck.pdf`. No package was added to the repository.

## Consequences

- Changing a slide means editing `deck/kandungan.json`, running the deck engine with `--tema web/src/styles/tokens.css
  --tema deck/tema.css`, and committing `deck/` and `docs/deck.pdf` together.
- The slides now use the engine's layout rather than the hand deck's two-colour design. The cover keeps the registry
  screenshot; slide 3 keeps the Try it screenshot.
- The deck engine is not part of this repository, so the PDF cannot be printed from a fresh clone. The committed PDF,
  the page and the hash test are what a reader can check.

## How to undo

Revert the commit that added this record: the hand deck files and their PDF come back, and the slide
links in `config/app.json` and the READMEs point at the old PDF again.
