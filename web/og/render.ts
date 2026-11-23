// Draws the link preview image and the Apple touch icon into web/public/ with headless Chromium.
// Run by hand after changing the preview text, colours or brand mark: `pnpm --filter @mentari/web og`.
// The output files are committed, so building the site never needs a browser.
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import app from "../../config/app.json" with { type: "json" };
import en from "../locales/en.json" with { type: "json" };
import ms from "../locales/ms.json" with { type: "json" };
import { logoSvg, readWeb, siteFonts, tokensCss, webDir as web } from "./assets.js";
import { cardHtml, touchIconHtml } from "./card.js";

const share = app.web.share;
const logo = logoSvg();
const html = cardHtml({
  template: readWeb("og/card.html").toString("utf8"),
  web: app.web,
  catalogues: { en, ms },
  tokensCss: tokensCss(),
  logoSvg: logo,
  fonts: siteFonts(),
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
  await capture(touchIconHtml(logo, size), size, size, share.appleTouchIcon);
  console.log(`wrote public${share.image} (${Math.ceil(bytes / 1024)} KB) and public${share.appleTouchIcon}`);
} finally {
  await browser.close();
}
