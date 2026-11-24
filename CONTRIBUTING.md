# Contributing

Thanks for helping. Mentari's contracts make promises about atomicity and post-quantum keys, so changes to them get
extra scrutiny.

## Set up

Node.js 22 (see `.nvmrc`) and pnpm 12.9.1. The test script installs a pinned Foundry if `forge` is missing.

```sh
git clone --recurse-submodules https://github.com/aimanmalib/mentari.git
cd mentari
pnpm install --frozen-lockfile
bash scripts/gerbang-ujian.sh   # forge build, test, fmt and coverage, vitest, web build, secret scan
pnpm build && pnpm start        # the site on http://localhost:8080, reading the testnet
```

## Before you open a pull request

- Run `bash scripts/gerbang-ujian.sh`; CI runs the same script.
- A change to a contract needs a test that fails without it. Name fuzz tests `testFuzz_*` and invariants
  `invariant_*`. Coverage of `contracts/src` must stay at 90 % or more, and `forge fmt --check` must be clean.
- The contracts have no owner, pause, upgrade, `approve` or `payable` function. A change that adds one needs a decision
  record first.
- Values that may change (addresses, limits, endpoints) go in `config/`, not in code.
- Text on the site goes in `web/locales/en.json` and `web/locales/ms.json`, with the same keys in both.
- A design decision gets a short record in `docs/decisions/`, with how to undo it.
- Source files stay under 400 lines. One topic per pull request; say how you tested it.

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE) and that you follow
the [Code of Conduct](CODE_OF_CONDUCT.md).
