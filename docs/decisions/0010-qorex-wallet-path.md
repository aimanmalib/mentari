# 0010. A QoreX wallet path, tested with the wallet mock

Date: 2026-11-22. Status: accepted.

## Context

"Retire now" sends from a demo account on the server, so a judge needs no wallet. The design brief also asks for a
second path: connect QoreX with `@qorechain/qorex-rainbowkit`, ask the demo account for 500 Wh, and retire from the
wallet, tested end to end with `@qorechain/qorex-wallet-mock`.

The kit README for `@qorechain/qorex-rainbowkit` 0.1.0 (read on 22 November 2026) says what QoreX answers on the EVM
lane today: `eth_chainId`, `eth_accounts`, `eth_requestAccounts` and `wallet_switchEthereumChain`. Signing methods,
including `eth_sendTransaction`, are "not supported yet" and are refused with "QoreX: EVM method ... not yet
supported". The wallet mock has two profiles: `current` (QoreX today) and `planned` (what QoreX has announced, which
signs and sends EVM transactions). The chain also accepts an EVM transaction only from an account with a registered
ML-DSA-87 key and an open EVM authorization window, both set up from the Native lane.

So with today's QoreX, connecting works and the last step, the wallet signing `retire`, does not.

## Decision

- Build the path as the brief says and be plain about the last step. The Try it page has a "Retire from your own
  wallet" section. It says before any click that QoreX does not sign EVM transactions yet and that "Retire now" needs
  no wallet. When the wallet refuses, the page says so and that nothing was sent.
- QoreX is the only wallet offered. Other injected wallets are not discovered (`multiInjectedProviderDiscovery:
  false`), because the point is an account with an ML-DSA-87 key. The connector re-reads the account and network
  when the page regains focus, since QoreX does not emit change events yet.
- After connecting, the page shows the EVM address, the same bytes as a Native `qor1` address,
  `Mentari.isQuantumReady` and `Mentari.balanceOf` for the account.
- `POST /api/demo/grant/<address>` makes the demo account `transfer` `demo.grantWh` (config/limits.json) to the
  wallet. It shares the per-IP, daily and one-at-a-time limits with the other demo buttons. It checks
  `isQuantumReady` before any quota is used, because `transfer` refuses accounts without a key.
- "Retire" simulates `retire(wh, memo)` first, so a contract error is explained before the wallet is asked, then asks
  the wallet to send it, waits for the receipt and links the new retirement on the Verify page. The memo is
  `web.wallet.memo` in config/app.json.
- wagmi, RainbowKit and React Query load only with the Try it page. The RainbowKit dialog uses the site's tokens and
  no backdrop filter, because a filter on an animated overlay can crash WebKit on iPhone.
- Playwright tests the path in Chromium and in WebKit as an iPhone 13, with the mock injected and a fake EVM node
  inside the test: the `current` profile is refused and nothing is sent; the `planned` profile sends
  `retire(500, memo)` to the contract; a declined request sends nothing; an account without a key cannot ask for
  certificates; the Malay page fits the screen. The site is built with `--mode e2e`, which only sets a test contract
  address. The gate and GitHub Actions run these tests.

## Consequences

- The README says the wallet path is tested with the wallet mock only, and that QoreX today refuses the last step.
- Nothing here was tried with the real QoreX extension or on the testnet. The grant endpoint answers "unavailable"
  until the contracts and the demo sender are on the testnet.
- The web install is larger (wagmi, RainbowKit and their dependencies). The first page load is not: the main bundle
  grew by about 5 kB, and the wallet code is a separate file loaded on the Try it page.
- When QoreX starts signing EVM transactions, the path should work without a code change. The `planned` test is the
  evidence for that, not a promise.

## How to undo

Remove the `<WalletPanel />` line and its `lazy` import in `web/src/pages/TryIt.tsx`; the page then shows only the
demo buttons, and the wallet code is no longer built into the site. To close the grant endpoint alone, set
`demo.enabled` to `false` (this also closes the other demo buttons) or revert the grant commit.
