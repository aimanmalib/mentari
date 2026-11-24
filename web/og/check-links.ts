// Opens the pages in config/app.json web.linkCheck on the live site in a fresh browser context (no cookies) and
// checks every transaction link a visitor can press: no EVM hash goes to the explorer, and each /go/ link redirects
// to the explorer page of a Cosmos hash. Run by hand after a deploy: `pnpm --filter @mentari/web links`.
import { chromium } from "@playwright/test";
import app from "../../config/app.json" with { type: "json" };
import { checkLink, isExplorerTx, linkPages, type LinkKind } from "./links.js";

const site = app.web.share.siteUrl;
const templates = app.web.explorer;
const pages = linkPages(app.web.linkCheck.pages);
const problems: string[] = [];
const goLinks = new Set<string>();
const browser = await chromium.launch();
try {
  for (const p of pages) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${site}${p.path}`, { waitUntil: "networkidle" });
    await page.waitForSelector(p.ready, { timeout: 30_000 });
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") ?? ""));
    await context.close();
    const count: Record<LinkKind, number> = { "explorer-tx": 0, "go-tx": 0, "go-receipt": 0, other: 0 };
    for (const href of hrefs) {
      const { kind, problem } = checkLink(href, templates);
      count[kind]++;
      if (problem) problems.push(`${p.path}: ${problem} ${href}`);
      if (kind === "go-tx" || kind === "go-receipt") goLinks.add(href);
    }
    const tx0x = hrefs.filter((h) => checkLink(h, templates).problem === "evm-hash-on-explorer").length;
    console.log(
      `${p.path}: ${count["explorer-tx"]} explorer tx, ${count["go-tx"]} /go/tx, ${count["go-receipt"]} /go/receipt, ` +
        `${tx0x} explorer tx/0x`,
    );
  }
} finally {
  await browser.close();
}

const max = app.web.linkCheck.maxRedirectChecks;
const toCheck = [...goLinks].slice(0, max);
let redirected = 0;
for (const href of toCheck) {
  const res = await fetch(`${site}${href}`, { redirect: "manual" });
  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && isExplorerTx(location, templates)) redirected++;
  else problems.push(`${href}: ${res.status} ${location ?? "no location"}`);
}
console.log(`/go/ links: ${goLinks.size} found, ${toCheck.length} opened, ${redirected} redirect to a Cosmos hash`);

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
