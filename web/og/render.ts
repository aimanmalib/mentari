// Draws the link preview image and the Apple touch icon into web/public/ with headless Chromium.
// Run by hand after changing the preview text, colours or brand mark: `pnpm --filter @mentari/web og`.
// The output files are committed, so building the site never needs a browser.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import app from "../../config/app.json" with { type: "json" };
import en from "../locales/en.json" with { type: "json" };
import ms from "../locales/ms.json" with { type: "json" };
import { cardHtml, touchIconHtml, type CardFont } from "./card.js";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const share = app.web.share;
const read = (path: string) => readFileSync(join(web, path));
const font = (pkg: string, file: string, family: string, weight: string, stretch?: string): CardFont => ({
  family,
  woff2: read(`node_modules/${pkg}/files/${file}`),
  weight,
  ...(stretch ? { stretch } : {}),
});

const logoSvg = readFileSync(join(web, "../brand/logo.svg"), "utf8");
const html = cardHtml({
  template: read("og/card.html").toString("utf8"),
  web: app.web,
  catalogues: { en, ms },
  tokensCss: read("src/styles/tokens.css").toString("utf8"),
  logoSvg,
  fonts: [
    font("@fontsource-variable/bricolage-grotesque", "bricolage-grotesque-latin-wdth-normal.woff2",
      "Bricolage Grotesque Variable", "200 800", "75% 100%"),
    font("@fontsource-variable/instrument-sans", "instrument-sans-latin-wght-normal.woff2",
      "Instrument Sans Variable", "400 700"),
    font("@fontsource/ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2", "IBM Plex Mono", "500"),
  ],
});

const browser = await chromium.launch();
try {
  const capture = async (content: string, width: number, height: number, out: string) => {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(content, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const type = out.endsWith(".png") ? "png" : "jpeg";
    const image = await page.screenshot({ type, ...(type === "jpeg" ? { quality: 85 } : {}) });
    await page.close();
    writeFileSync(join(web, "public", out), image);
    return statSync(join(web, "public", out)).size;
  };
  const bytes = await capture(html, share.imageWidth, share.imageHeight, share.image);
  if (bytes > share.imageMaxKb * 1024) {
    throw new Error(`preview image is ${Math.ceil(bytes / 1024)} KB, over web.share.imageMaxKb ${share.imageMaxKb}`);
  }
  const size = share.appleTouchIconSize;
  await capture(touchIconHtml(logoSvg, size), size, size, share.appleTouchIcon);
  console.log(`wrote public${share.image} (${Math.ceil(bytes / 1024)} KB) and public${share.appleTouchIcon}`);
} finally {
  await browser.close();
}
