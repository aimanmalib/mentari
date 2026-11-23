// Draws the submission cover image into brand/ with headless Chromium: the name, the tagline and a shot of the
// live site taken in the same run, so the product in the picture is the one people can open.
// Run by hand when the site, the tagline or the brand changes: `pnpm --filter @mentari/web cover`.
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import app from "../../config/app.json" with { type: "json" };
import en from "../locales/en.json" with { type: "json" };
import ms from "../locales/ms.json" with { type: "json" };
import { logoSvg, readWeb, repoDir, siteFonts, tokensCss } from "./assets.js";
import { coverHtml } from "./cover.js";

const { cover, share } = app.web;
const browser = await chromium.launch();
try {
  const live = await browser.newPage({ viewport: { width: cover.shotWidth, height: cover.shotHeight } });
  await live.goto(`${share.siteUrl}${cover.shotPath}`, { waitUntil: "networkidle" });
  await live.waitForSelector(cover.shotReadySelector, { timeout: 30_000 });
  await live.evaluate(() => document.fonts.ready.then(() => undefined));
  const shotPng = await live.screenshot({ type: "png" });
  await live.close();

  const html = coverHtml({
    template: readWeb("og/cover.html").toString("utf8"),
    web: app.web,
    cover,
    catalogues: { en, ms },
    tokensCss: tokensCss(),
    logoSvg: logoSvg(),
    fonts: siteFonts(),
    shotPng,
  });
  const page = await browser.newPage({ viewport: { width: cover.width, height: cover.height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const out = join(repoDir, cover.image);
  writeFileSync(out, await page.screenshot({ type: "png" }));
  const kb = Math.ceil(statSync(out).size / 1024);
  if (kb > cover.maxKb) throw new Error(`cover image is ${kb} KB, over web.cover.maxKb ${cover.maxKb}`);
  console.log(`wrote ${cover.image} (${kb} KB) from ${share.siteUrl}${cover.shotPath}`);
} finally {
  await browser.close();
}
