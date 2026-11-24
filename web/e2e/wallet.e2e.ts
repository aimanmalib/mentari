import { expect, test, type Page } from "@playwright/test";
import { createQorexMock, type QorexMockOptions } from "@qorechain/qorex-wallet-mock";
import limits from "../../config/limits.json" with { type: "json" };
import app from "../../config/app.json" with { type: "json" };
import { nativeToEvm } from "../src/data/address.js";
import { FakeChain, HOLDER } from "./fake-chain.js";
import { FakeNative } from "./fake-native.js";

/**
 * The wallet path on the Try it page, end to end in a real browser, with the QoreX wallet mock injected, a fake EVM
 * node and a fake Native REST endpoint. `current` is what QoreX does today: it signs and sends Native transactions
 * (`signAndBroadcast`, hybrid ML-DSA-87) and refuses EVM signing. `planned` is what QoreX has announced.
 */
const WH = limits.demo.grantWh;
const RETIRE_WH = limits.demo.retireWh;

const MEMO = app.web.wallet.memo;
/** The mock's Native account (its own key, not the EVM account's), and the address a contract sees for its calls. */
const NATIVE = createQorexMock().addresses().native;
const NATIVE_EVM = nativeToEvm(NATIVE);

/** Removes QoreX's Native provider, as an older QoreX build without `signAndBroadcast` would look to the page. */
const WITHOUT_NATIVE = `(() => { const q = window.qorex; if (q) window.qorex = { ...q, native: undefined }; })();`;

async function open(page: Page, chain: FakeChain, opts: QorexMockOptions, path = "/try", native = true): Promise<FakeNative> {
  const rest = new FakeNative(chain);
  await chain.install(page);
  await rest.install(page);
  // The page asks the server for the demo status; the static preview has no server.
  await page.route("**/api/demo/status", (r) => r.fulfill({ status: 503, json: {} }));
  await page.route("**/api/demo/grant/*", async (route) => {
    const to = route.request().url().split("/").pop()!;
    await route.fulfill({ status: 200, json: { ok: true, action: "grant", to, wh: WH, evmTx: chain.grant(to, BigInt(WH)) } });
  });
  await page.addInitScript({ content: createQorexMock(opts).initScript() });
  if (!native) await page.addInitScript({ content: WITHOUT_NATIVE });
  await page.goto(path);
  return rest;
}

async function connect(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^QoreX$/ }).click();
}

const wallet = (page: Page) => page.locator("section.wallet");
const requests = (page: Page) => page.evaluate(() => window.__qorexMock!.requests.map((r) => ({ method: r.method, outcome: r.outcome, error: r.error })));
const methods = async (page: Page) => (await requests(page)).map((r) => r.method);

test("QoreX today: get certificates, retire through the Native lane, and land on the retirement", async ({ page }) => {
  const chain = new FakeChain();
  const rest = await open(page, chain, { profile: "current" });
  await connect(page);

  const w = wallet(page);
  // QoreX's EVM account is another key; the Native lane uses the Native account and shows its EVM form.
  expect(NATIVE_EVM).not.toBe(HOLDER);
  await expect(w.getByText(NATIVE_EVM.slice(0, 8))).toBeVisible();
  await expect(w.getByText(NATIVE.slice(0, 9))).toBeVisible();
  await expect(w.getByText("This path uses your Native account", { exact: false })).toBeVisible();
  await expect(w.getByText("Yes. An ML-DSA-87 key is registered.")).toBeVisible();
  await expect(w.getByRole("button", { name: `Retire ${RETIRE_WH} Wh` })).toBeDisabled();

  await w.getByRole("button", { name: `Get ${WH} Wh` }).click();
  await expect(w.getByText(`The demo account sent you ${WH} Wh:`)).toBeVisible();
  expect(chain.balance(NATIVE_EVM)).toBe(BigInt(WH));

  await w.getByRole("button", { name: `Retire ${RETIRE_WH} Wh` }).click();
  await expect(w.getByText("Retired from your wallet through the Native lane:")).toBeVisible({ timeout: 20_000 });
  expect(chain.balance(NATIVE_EVM)).toBe(BigInt(WH - RETIRE_WH));
  await expect(w.getByRole("link", { name: "Retirement 7" })).toHaveAttribute("href", "/verify?n=7");
  await expect(w.getByText("it carries your ML-DSA-87 signature", { exact: false })).toBeVisible();
  const tx = rest.txs.at(-1)!.hash;
  await expect(w.locator(`a[href$="/tx/${tx}"]`)).toBeVisible();

  expect(rest.crossVmCalls().map((c) => ({ ...c, contract: c.contract.toLowerCase() }))).toEqual([
    { sender: NATIVE, targetVm: "evm", contract: chain.contract, call: { functionName: "retire", args: [BigInt(RETIRE_WH), MEMO] } },
  ]);
  expect(await methods(page)).toContain("native:signAndBroadcast");
  expect(await methods(page)).not.toContain("evm:eth_sendTransaction");
  expect(chain.sent).toEqual([]);
});

test("an account without an ML-DSA-87 key registers one through QoreX before it asks for certificates", async ({ page }) => {
  const chain = new FakeChain();
  chain.quantumReady = false;
  const rest = await open(page, chain, { profile: "current" });
  await connect(page);
  const w = wallet(page);
  await expect(w.getByText("No ML-DSA-87 key yet. QoreX registers one with your first transaction.")).toBeVisible();
  await expect(w.getByRole("button", { name: `Get ${WH} Wh` })).toBeDisabled();

  await w.getByRole("button", { name: "Register my key" }).click();
  await expect(w.getByText("Your ML-DSA-87 key is registered:")).toBeVisible({ timeout: 20_000 });
  await expect(w.getByText("Yes. An ML-DSA-87 key is registered.")).toBeVisible();
  await expect(w.getByRole("button", { name: `Get ${WH} Wh` })).toBeEnabled();
  await expect(w.getByRole("button", { name: "Register my key" })).toHaveCount(0);
  // QoreX's own registration first, then the page's 1 uqor send to itself.
  expect(rest.typeUrls()).toEqual([["/qorechain.pqc.v1.MsgRegisterPQCKeyV2"], ["/cosmos.bank.v1beta1.MsgSend"]]);
});

test("an account the chain has never seen is told to use the faucet", async ({ page }) => {
  const chain = new FakeChain();
  chain.quantumReady = false;
  const rest = await open(page, chain, { profile: "current" });
  rest.funded = false;
  await connect(page);
  const w = wallet(page);
  await w.getByRole("button", { name: "Register my key" }).click();
  await expect(w.getByText("This account has no QOR on the testnet yet.", { exact: false })).toBeVisible();
  expect(rest.txs).toEqual([]);
});

test("a QoreX build without Native sending falls back to EVM, which QoreX refuses to sign", async ({ page }) => {
  const chain = new FakeChain();
  chain.balances.set(HOLDER.toLowerCase(), BigInt(RETIRE_WH));
  await open(page, chain, { profile: "current" }, "/try", false);
  await connect(page);
  const w = wallet(page);
  await expect(w.getByText(HOLDER.slice(0, 8))).toBeVisible();
  await w.getByRole("button", { name: `Retire ${RETIRE_WH} Wh` }).click();
  await expect(w.getByText("QoreX refused to sign this EVM transaction.", { exact: false })).toBeVisible();
  expect(await requests(page)).toContainEqual({
    method: "evm:eth_sendTransaction",
    outcome: "error",
    error: "QoreX: EVM method eth_sendTransaction not yet supported",
  });
  expect(chain.sent).toEqual([]);
});

test("QoreX as announced, without Native sending: the EVM retire is signed, sent and linked", async ({ page }) => {
  const chain = new FakeChain();
  chain.balances.set(HOLDER.toLowerCase(), BigInt(RETIRE_WH));
  await open(page, chain, { profile: "planned" }, "/try", false);
  await connect(page);

  const w = wallet(page);
  await w.getByRole("button", { name: `Retire ${RETIRE_WH} Wh` }).click();
  await expect(w.getByText("Retired from your wallet:")).toBeVisible();
  await expect(w.getByRole("link", { name: "Retirement 7" })).toHaveAttribute("href", "/verify?n=7");

  expect(chain.sent).toHaveLength(1);
  expect(chain.sent[0]!.to?.toLowerCase()).toBe(chain.contract);
  expect(chain.sent[0]!.call).toEqual({ functionName: "retire", args: [BigInt(RETIRE_WH), MEMO] });
});

test("a request declined in the wallet sends nothing", async ({ page }) => {
  const chain = new FakeChain();
  chain.balances.set(NATIVE_EVM.toLowerCase(), BigInt(RETIRE_WH));
  const rest = await open(page, chain, { profile: "current", autoApprove: false });
  await page.getByRole("button", { name: "Connect QoreX" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^QoreX$/ }).click();
  await expect.poll(() => page.evaluate(() => window.__qorexMock!.pendingApprovals)).toBe(1);
  await page.evaluate(() => window.__qorexMock!.approveNext());

  const w = wallet(page);
  await w.getByRole("button", { name: `Retire ${RETIRE_WH} Wh` }).click();
  await expect.poll(() => page.evaluate(() => window.__qorexMock!.pendingApprovals)).toBe(1);
  await page.evaluate(() => window.__qorexMock!.rejectNext());
  await expect(w.getByText("You declined the request in your wallet. Nothing was sent.")).toBeVisible();
  expect(rest.txs).toEqual([]);
  expect(chain.sent).toEqual([]);
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
