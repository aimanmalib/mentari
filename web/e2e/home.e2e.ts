import { expect, test } from "@playwright/test";
import limits from "../../config/limits.json" with { type: "json" };
import en from "../locales/en.json" with { type: "json" };
import app from "../../config/app.json" with { type: "json" };

/** The home page's first screen and its one action, in a real browser (Chromium 1440 and WebKit iPhone 13). */
const CTA = en.home.cta.replace("{wh}", String(limits.demo.retireWh));

test("the first screen shows the action, the story has its sections, and the action presses Retire now once", async ({ page }) => {
  // No chain in this test: the registry shows its "could not read" state, which is enough for the page's shape.
  await page.route(`${app.network.evmRpc.replace(/\/$/, "")}/**`, (r) => r.fulfill({ status: 503, body: "" }));
  await page.route(app.network.evmRpc, (r) => r.fulfill({ status: 503, body: "" }));
  await page.route("**/lcd/**", (r) => r.fulfill({ status: 503, body: "" }));
  await page.route("**/api/demo/status", (r) => r.fulfill({ status: 503, json: {} }));
  const posts: string[] = [];
  await page.route("**/api/demo/retire", async (r) => {
    posts.push(r.request().method());
    await r.fulfill({ status: 503, json: { ok: false } });
  });
  await page.goto("/");

  const cta = page.getByRole("button", { name: CTA });
  await expect(cta).toBeInViewport();
  expect(await page.locator("main h2").count()).toBeGreaterThanOrEqual(4);
  expect(await page.locator("main img, main video").count()).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await cta.click();
  await expect(page).toHaveURL(/\/try$/);
  await expect.poll(() => posts.length).toBe(1);
  expect(posts).toEqual(["POST"]);

  // A reload does not press again: the request lived in history state and was cleared.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(posts.length).toBe(1);
});
