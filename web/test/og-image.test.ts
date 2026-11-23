import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardHtml, fontFaces, touchIconHtml } from "../og/card.js";
import { coverHtml, type CoverConfig } from "../og/cover.js";
import type { WebConfig } from "../share-meta.js";
import app from "../../config/app.json" with { type: "json" };

const publicFile = (path: string) => new URL(`../public${path}`, import.meta.url);

/** Width and height from the IHDR chunk of a PNG file. */
function pngSize(file: URL): { width: number; height: number } {
  const head = readFileSync(file).subarray(0, 24);
  expect(head.subarray(0, 8).toString("hex"), "PNG signature").toBe("89504e470d0a1a0a");
  expect(head.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

describe("committed preview images", () => {
  const share = app.web.share;

  it("the preview image has the size web.share names and stays under the byte limit", () => {
    const file = publicFile(share.image);
    expect(pngSize(file)).toEqual({ width: share.imageWidth, height: share.imageHeight });
    expect(statSync(file).size).toBeLessThanOrEqual(share.imageMaxKb * 1024);
  });

  it("the Apple touch icon is a square PNG of web.share.appleTouchIconSize", () => {
    const size = share.appleTouchIconSize;
    expect(pngSize(publicFile(share.appleTouchIcon))).toEqual({ width: size, height: size });
  });

  it("the cover image has the size web.cover names and stays under the byte limit", () => {
    const cover = app.web.cover;
    const file = new URL(`../../${cover.image}`, import.meta.url);
    expect(pngSize(file)).toEqual({ width: cover.width, height: cover.height });
    expect(statSync(file).size).toBeLessThanOrEqual(cover.maxKb * 1024);
  });
});

// A frozen fixture: the card tests check the template filling, not the owner's wording.
const web: WebConfig = {
  defaultLocale: "en",
  locales: ["en", "ms"],
  share: {
    siteUrl: "https://example.test",
    siteName: "Site & Co",
    image: "/card.png",
    imageWidth: 640,
    imageHeight: 320,
    imageMaxKb: 50,
    twitterCard: "card-kind",
    appleTouchIcon: "/touch.png",
    appleTouchIconSize: 99,
    ogLocales: { en: "en_XX", ms: "ms_XX" },
  },
};
const catalogues = { en: { meta: { title: "A <b> title", description: 'Say "hi"', imageAlt: "Alt" } } };
const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><title>X</title><rect rx="7"/></svg>';
const base = { web, catalogues, tokensCss: ":root{--x:1}", logoSvg, fonts: [] };

describe("preview card template", () => {
  it("fills every slot of the real template, escaped, at the configured size", () => {
    const template = readFileSync(new URL("../og/card.html", import.meta.url), "utf8");
    const html = cardHtml({ ...base, template });
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).toContain("A &lt;b&gt; title");
    expect(html).toContain("Say &quot;hi&quot;");
    expect(html).toContain("Site &amp; Co");
    expect(html).toContain("example.test");
    expect(html).toContain("width: 640px; height: 320px;");
    expect(html).toContain(":root{--x:1}");
    expect(html).not.toContain("<title>");
  });

  it("stops on a slot it does not know and on a missing locale text", () => {
    expect(() => cardHtml({ ...base, template: "{{nope}}" })).toThrow(/unknown slot \{\{nope\}\}/);
    expect(() => cardHtml({ ...base, template: "{{title}}", catalogues: { en: { meta: {} } } })).toThrow(/meta\.title/);
  });

  it("embeds fonts as data URLs", () => {
    const css = fontFaces([{ family: "F", woff2: Buffer.from("abc"), weight: "400", stretch: "80% 100%" }]);
    expect(css).toContain('font-family: "F"');
    expect(css).toContain("data:font/woff2;base64,YWJj");
    expect(css).toContain("font-stretch: 80% 100%;");
  });

  it("draws the touch icon square, full bleed, at the given size", () => {
    const html = touchIconHtml(logoSvg, 99);
    expect(html).toContain('width="99" height="99"');
    expect(html).not.toContain("rx=");
    expect(html).not.toContain("<title>");
  });
});

describe("cover template", () => {
  const cover: CoverConfig = {
    image: "x/cover.png", width: 800, height: 450, maxKb: 10, shotPath: "/", shotReadySelector: ".ready", shotWidth: 16, shotHeight: 10,
  };
  const texts = { cover: { kicker: "Fest & Co", tagline: "Once <only>", shotAlt: 'The "live" page' } };
  const input = { ...base, cover, catalogues: { en: texts }, shotPng: Buffer.from("png") };

  it("fills every slot of the real template, escaped, with the shot as a data URL", () => {
    const template = readFileSync(new URL("../og/cover.html", import.meta.url), "utf8");
    const html = coverHtml({ ...input, template });
    expect(html).not.toMatch(/\{\{\w+\}\}/);
    expect(html).toContain("Fest &amp; Co");
    expect(html).toContain("Once &lt;only&gt;");
    expect(html).toContain('alt="The &quot;live&quot; page"');
    expect(html).toContain("data:image/png;base64,cG5n");
    expect(html).toContain("width: 800px; height: 450px;");
    expect(html).toContain("aspect-ratio: 16 / 10;");
    expect(html).toContain("Site &amp; Co");
    expect(html).not.toContain("<title>");
  });

  it("stops on a slot it does not know and on a missing cover text", () => {
    expect(() => coverHtml({ ...input, template: "{{nope}}" })).toThrow(/cover\.html has an unknown slot \{\{nope\}\}/);
    const noTagline = { en: { cover: { kicker: "k", shotAlt: "a" } } };
    expect(() => coverHtml({ ...input, template: "{{tagline}}", catalogues: noTagline })).toThrow(/cover\.tagline/);
    const blankTagline = { en: { cover: { kicker: "k", tagline: "  ", shotAlt: "a" } } };
    expect(() => coverHtml({ ...input, template: "{{tagline}}", catalogues: blankTagline })).toThrow(/cover\.tagline/);
  });
});
