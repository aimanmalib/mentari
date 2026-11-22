import { expect, test, type Page } from "@playwright/test";
import { createQorexMock, type QorexMockOptions } from "@qorechain/qorex-wallet-mock";
import limits from "../../config/limits.json" with { type: "json" };
import app from "../../config/app.json" with { type: "json" };
import { FakeChain, HOLDER } from "./fake-chain.js";

/**
 * The wallet path on the Try it page, end to end in a real browser, with the QoreX wallet mock injected and a fake
 * EVM node. `current` is what QoreX does today (no EVM signing); `planned` is what QoreX has announced.
 */
const WH = limits.demo.grantWh;
const RETIRE_WH = limits.demo.retireWh;

async function open(page: Page, chain: FakeChain, opts: QorexMockOptions, path = "/try"): Promise<void> {
  await chain.install(page);
  // The page asks the server for the demo status; the static preview has no server.
  await page.route("**/api/demo/status", (r) => r.fulfill({ status: 503, json: {} }));
  await page.route("**/api/demo/grant/*", async (route) => {
    const to = route.request().url().split("/").pop()!;
    await route.fulfill({ status: 200, json: { ok: true, action: "grant", to, wh: WH, evmTx: chain.grant(to, BigInt(WH)) } });
  });
  await page.addInitScript({ content: createQorexMock(opts).initScript() });
  await page.goto(path);
}

async function connect(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^QoreX$/ }).click();
}

const wallet = (page: Page) => page.locator("section.wallet");
const requests = (page: Page) => page.evaluate(() => window.__qorexMock!.requests.map((r) => ({ method: r.method, outcome: r.outcome, error: r.error })));

test("QoreX today: connect, get certificates, and see the wallet refuse to sign the EVM retire", async ({ page }) => {
  const chain = new FakeChain();
  await open(page, chain, { profile: "current" });
  await connect(page);

  const w = wallet(page);
  await expect(w.getByText(HOLDER.slice(0, 8))).toBeVisible();
  expect(await page.evaluate(() => window.__qorexMock!.addresses().evm)).toBe(HOLDER);
  await expect(w.getByText("Yes. An ML-DSA-87 key is registered.")).toBeVisible();
  await expect(w.getByText("0 Wh", { exact: true })).toBeVisible();
  await expect(w.getByRole("button", { name: `Retire ${RETIRE_WH} Wh` })).toBeDisabled();

  await w.getByRole("button", { name: `Get ${WH} Wh` }).click();
  await expect(w.getByText(`The demo account sent you ${WH} Wh:`)).toBeVisible();
  await expect(w.getByText(`${WH} Wh`, { exact: true })).toBeVisible();

  await w.getByRole("button", { name: `Retire ${RETIRE_WH} Wh` }).click();
  await expect(w.getByText("QoreX refused to sign this EVM transaction.", { exact: false })).toBeVisible();
  expect(await requests(page)).toContainEqual({
    method: "evm:eth_sendTransaction",
    outcome: "error",
    error: "QoreX: EVM method eth_sendTransaction not yet supported",
  });
  expect(chain.sent).toEqual([]);
});

test("QoreX as announced: the retire is signed, sent to Mentari and linked to its retirement", async ({ page }) => {
  const chain = new FakeChain();
  chain.balances.set(HOLDER.toLowerCase(), BigInt(RETIRE_WH));
  await open(page, chain, { profile: "planned" });
  await connect(page);

  const w = wallet(page);
  await w.getByRole("button", { name: `Retire ${RETIRE_WH} Wh` }).click();
  await expect(w.getByText("Retired from your wallet:")).toBeVisible();
  await expect(w.getByRole("link", { name: "Retirement 7" })).toHaveAttribute("href", "/verify?n=7");

  expect(chain.sent).toHaveLength(1);
  expect(chain.sent[0]!.to?.toLowerCase()).toBe(chain.contract);
  expect(chain.sent[0]!.call).toEqual({ functionName: "retire", args: [BigInt(RETIRE_WH), app.web.wallet.memo] });
});

test("a request declined in the wallet sends nothing", async ({ page }) => {
  const chain = new FakeChain();
  chain.balances.set(HOLDER.toLowerCase(), BigInt(RETIRE_WH));
  await open(page, chain, { profile: "planned", autoApprove: false });
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^QoreX$/ }).click();
  await expect.poll(() => page.evaluate(() => window.__qorexMock!.pendingApprovals)).toBe(1);
  await page.evaluate(() => window.__qorexMock!.approveNext());

  const w = wallet(page);
  await w.getByRole("button", { name: `Retire ${RETIRE_WH} Wh` }).click();
  await expect.poll(() => page.evaluate(() => window.__qorexMock!.pendingApprovals)).toBe(1);
  await page.evaluate(() => window.__qorexMock!.rejectNext());
  await expect(w.getByText("You declined the request in your wallet. Nothing was sent.")).toBeVisible();
  expect(chain.sent).toEqual([]);
});

test("an account without an ML-DSA-87 key cannot ask for certificates", async ({ page }) => {
  const chain = new FakeChain();
  chain.quantumReady = false;
  await open(page, chain, { profile: "current" });
  await connect(page);
  const w = wallet(page);
  await expect(w.getByText("No ML-DSA-87 key yet. Register one in QoreX first.")).toBeVisible();
  await expect(w.getByRole("button", { name: `Get ${WH} Wh` })).toBeDisabled();
});

test("the wallet path speaks Bahasa Melayu, fits the screen and blurs nothing behind the dialog", async ({ page }) => {
  const chain = new FakeChain();
  await open(page, chain, { profile: "current" }, "/try?lang=ms");
  await page.getByRole("button", { name: "Sambung QoreX" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const filtered = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-rk], [data-rk] *")].filter((e) => {
        const style = getComputedStyle(e) as CSSStyleDeclaration & { webkitBackdropFilter?: string };
        return [style.backdropFilter, style.webkitBackdropFilter].some((v) => v && v !== "none");
      }).length,
  );
  expect(filtered).toBe(0);
  await page.getByRole("dialog").getByRole("button", { name: /^QoreX$/ }).click();
  const w = wallet(page);
  await expect(w.getByRole("heading", { name: "Bersarakan dari dompet anda sendiri" })).toBeVisible();
  await expect(w.getByText("Ya. Kunci ML-DSA-87 sudah didaftarkan.")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
