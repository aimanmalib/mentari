import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, chromium, type Page } from "@playwright/test";
// Film capture: real states of the live site and the public explorer (Testnet selected), 1280 CSS px at scale 2,
// full page, plus element boxes for the camera. Presses "Retire now" and "Write, then revert" once each (2 of 5 per hour).
const BASE = "https://mentari.sasateguh.com";
const EXPLORER = "https://explore.qore.network/tx/";
const DOCS = "https://docs.qorechain.io/developer-guide/cross-vm-reference";
const NATIVE_TX = "8E15D319B2971FC5102C027BA8E3C8A8AAF1FDD72AD8E2172CEE2303B453B40A"; // case H step 2 in evidence/testnet.json
const OUT = "video/assets/shots";
const boxes: Record<string, unknown> = {};
const log: Record<string, unknown> = {};
type Sels = Record<string, string | RegExp>;
async function box(page: Page, s: string | RegExp) {
  const loc = typeof s === "string" ? page.locator(s) : page.getByText(s);
  if ((await loc.count()) === 0) return null;
  return loc.first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }).catch(() => null);
}
async function shot(page: Page, name: string, sels: Sels) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const b: Record<string, unknown> = { height: await page.evaluate(() => document.documentElement.scrollHeight) };
  for (const [k, s] of Object.entries(sels)) b[k] = await box(page, s);
  boxes[name] = b;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}
async function explorer(page: Page, name: string, hash: string) {
  await page.goto(EXPLORER + hash, { waitUntil: "networkidle", timeout: 90_000 });
  await page.getByText("Testnet", { exact: true }).first().click();
  await page.getByText(/quantum-safe/i).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const ev = page.getByText(/Events \(\d+\)/).last();
  if ((await ev.count()) > 0) { await ev.click(); await page.waitForTimeout(1500); }
  const text = await page.evaluate(() => document.body.innerText);
  log[name] = { hash, text: text.split("Get started")[0].slice(0, 2500), crossvmRequest: (text.match(/crossvm_request/g) ?? []).length,
    crossvmResponse: (text.match(/crossvm_response/g) ?? []).length };
  await shot(page, name, { messages: /Messages \(\d+\)/, msg: /^MsgCrossVMCall$/, sig: /Signature security/, safe: /^quantum-safe$/,
    status: /^(success|failed \(code \d+\))$/, error: /^Error log$/, events: /Events \(\d+\)/, crossvm: /^crossvm_request$/,
    response: /^crossvm_response$/ });
}
test("capture", async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "en-US" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?lang=en`);
  await page.locator('.seam[aria-busy="false"]').first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await shot(page, "registry", { seam: ".seam", hero: "main h1", main: "main" });
  await page.goto(`${BASE}/try?lang=en`);
  await page.waitForTimeout(2500);
  await shot(page, "try", { retire: ".retire-now", fails: ".demo-fails", out: ".demo-out", demo: ".demo", counts: ".counts" });
  const acts = [
    { name: "try-retire", path: "/api/demo/retire", btn: /^Retire now/ },
    { name: "try-b", path: "/api/demo/case/b", btn: /Write, then revert/ },
  ];
  for (const a of acts) {
    const ans = page.waitForResponse((r) => r.url().endsWith(a.path), { timeout: 120_000 });
    await page.getByRole("button", { name: a.btn }).first().click();
    const res = await ans;
    const body = await res.json();
    log[a.name] = { status: res.status(), body };
    console.log(`CAP ${a.name} ${res.status()} ${JSON.stringify(body).slice(0, 300)}`);
    await expect(page.locator(".demo-result").first()).toContainText("As expected", { timeout: 20_000 });
    await page.waitForTimeout(800);
    await shot(page, a.name, { retire: ".retire-now", fails: ".demo-fails", out: ".demo-out", result: ".demo-result", counts: ".counts", demo: ".demo" });
  }
  const n = (log["try-retire"] as { body: { retirements?: { after?: number } } })?.body?.retirements?.after ?? 1;
  await page.goto(`${BASE}/verify?n=${n}&lang=en`);
  await page.locator('.verify.pq[aria-busy="false"]').first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2000);
  await shot(page, "verify", { main: "main", report: "main h2", pq: ".verify.pq", pqrow: ".pq-row" });
  log.verifyN = n;
  await page.goto(`${BASE}/how-it-works?lang=en`);
  await page.waitForTimeout(2500);
  await shot(page, "how", { main: "main", svg: "main svg", finding: /Native account/ });
  await page.goto(`${DOCS}#native-to-evm`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(2000);
  log.docs = { url: DOCS, says: (await page.evaluate(() => document.body.innerText)).match(/Not yet tested against the live network[^\n]*/)?.[0] ?? null };
  await shot(page, "docs", { flag: /Not yet tested against the live network/, head: /Native.{0,20}EVM/ });
  log.errors = errors;
  writeFileSync("video/tangkap/kotak.json", JSON.stringify(boxes, null, 1));
  writeFileSync("video/tangkap/log.json", JSON.stringify(log, null, 1));
  await browser.close();
});
// Explorer pages only, for the transactions in the press log: rerun with -g explorer without pressing again.
test("explorer", async () => {
  Object.assign(log, JSON.parse(readFileSync("video/tangkap/log.json", "utf8")));
  Object.assign(boxes, JSON.parse(readFileSync("video/tangkap/kotak.json", "utf8")));
  const browser = await chromium.launch();
  const exp = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: "en-US" });
  const ep = await exp.newPage();
  await explorer(ep, "exp-retire", (log["try-retire"] as { body: { cosmosTx: string } }).body.cosmosTx);
  await explorer(ep, "exp-b", (log["try-b"] as { body: { cosmosTx: string } }).body.cosmosTx);
  await explorer(ep, "exp-native", NATIVE_TX);
  writeFileSync("video/tangkap/kotak.json", JSON.stringify(boxes, null, 1));
  writeFileSync("video/tangkap/log.json", JSON.stringify(log, null, 1));
  await browser.close();
});
