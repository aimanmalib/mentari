// Captures the screenshots in config/app.json web.shots from the live site, so the READMEs and the slides show
// testnet data, not the local fixture. Phones use WebKit with the Playwright device; the rest use Chromium.
// Run by hand when the site changes: `pnpm --filter @mentari/web shots`.
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices, webkit, type Browser } from "@playwright/test";
import app from "../../config/app.json" with { type: "json" };
import { repoDir } from "./assets.js";
import { shotList } from "./shots.js";

const { shots, share } = app.web;
const list = shotList(shots.list, Object.keys(devices));
const browsers: Partial<Record<"chromium" | "webkit", Browser>> = {};
try {
  for (const shot of list) {
    const engine = shot.device ? "webkit" : "chromium";
    const browser = (browsers[engine] ??= await (engine === "webkit" ? webkit : chromium).launch());
    const context = await browser.newContext(
      shot.device ? { ...devices[shot.device] } : { viewport: { width: shot.width!, height: shot.height! } },
    );
    const page = await context.newPage();
    await page.goto(`${share.siteUrl}${shot.path}`, { waitUntil: "networkidle" });
    await page.waitForSelector(shot.ready, { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const out = join(repoDir, shot.out);
    writeFileSync(out, await page.screenshot({ type: "png" }));
    await context.close();
    const kb = Math.ceil(statSync(out).size / 1024);
    if (kb > shots.maxKb) throw new Error(`${shot.out} is ${kb} KB, over web.shots.maxKb ${shots.maxKb}`);
    console.log(`wrote ${shot.out} (${kb} KB) from ${share.siteUrl}${shot.path} in ${engine}`);
  }
} finally {
  for (const b of Object.values(browsers)) await b?.close();
}
