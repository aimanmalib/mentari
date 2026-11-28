import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ms from "../locales/ms.json";
import { HomeHero, Poster } from "../src/components/HomeHero.js";
import { HomeFaq, HomeSteps, LatestProof } from "../src/components/HomeStory.js";
import { siteConfig } from "../src/config.js";
import { pressRequest, takePressRequest } from "../src/data/pressOnOpen.js";
import type { RegistrySnapshot } from "../src/data/types.js";
import { I18nProvider } from "../src/i18n/I18n.js";

const render = (el: ReactElement, locale = "en") => renderToStaticMarkup(<I18nProvider locale={locale}>{el}</I18nProvider>);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

const SNAPSHOT = {
  source: "live",
  contract: "0x0",
  contractNative: "qor1x",
  totals: { minted: 1n, retired: 1n, supply: 0n },
  retirementsCount: 2,
  systems: [],
  pairs: [{ n: 12, receiptId: 40, ok: true, problems: [] }],
  agreement: { state: "agree", checked: 1, total: 1 },
  readAt: 0,
} as unknown as RegistrySnapshot;

describe("Home hero", () => {
  it("has one action, a button and not a link, so a crawler never sends a retirement", () => {
    const html = render(<HomeHero />);
    expect(count(html, /<button/g)).toBe(1);
    expect(html).toContain(en.home.cta.replace("{wh}", String(siteConfig.demoRetireWh)));
    expect(html).not.toMatch(/href="[^"]*retire/);
    expect(html).toContain('href="/how-it-works"');
  });

  it("shows the cover in a frame, with alt text in both languages", () => {
    for (const [locale, text] of [["en", en], ["ms", ms]] as const) {
      const html = render(<HomeHero />, locale);
      expect(count(html, /<img /g)).toBe(1);
      expect(html).toContain(`alt="${text.home.posterAlt}"`);
    }
  });

  it("links the poster to the video only when config has one", () => {
    expect(render(<Poster video="" copy={{ path: "", bytes: 1 }} />)).not.toContain("<a ");
    const html = render(<Poster video="https://example.org/v" />);
    expect(html).toContain('href="https://example.org/v"');
    expect(html).toContain(en.home.watch);
  });

  it("offers the MP4 copy from this site under the poster, in both languages, sized from config", () => {
    const copy = { path: "/video/x.mp4", bytes: 12_400_000 };
    for (const [locale, text] of [["en", en], ["ms", ms]] as const) {
      const html = render(<Poster video="" copy={copy} />, locale);
      expect(html).toMatch(/<a class="poster-copy" href="\/video\/x.mp4" download="" type="video\/mp4">/);
      expect(html).toContain(text.home.videoCopy.replace("{mb}", "12"));
    }
    expect(render(<Poster video="" copy={{ path: "", bytes: 1 }} />)).not.toContain("poster-copy");
  });
});

describe("Home story", () => {
  it("lists the three steps in order", () => {
    const html = render(<HomeSteps />);
    expect(count(html, /<li /g)).toBe(3);
    expect(html.indexOf(en.home.steps.meter.title)).toBeLessThan(html.indexOf(en.home.steps.receipt.title));
  });

  it("asks every question config lists, with an answer, in both languages", () => {
    for (const [locale, text] of [["en", en], ["ms", ms]] as const) {
      const html = render(<HomeFaq />, locale);
      expect(count(html, /<details/g)).toBe(siteConfig.home.faq.length);
      for (const id of siteConfig.home.faq) {
        const qa = (text.home.faq as Record<string, { q: string; a: string } | undefined>)[id];
        expect(qa?.q && qa.a, `${locale} home.faq.${id}`).toBeTruthy();
      }
    }
  });

  it("links the newest retirement's Native transaction through the receipt route, with the explorer note", () => {
    const html = render(<LatestProof snapshot={SNAPSHOT} />);
    expect(html).toContain(`href="${siteConfig.explorer.receiptTx.replace("{id}", "40")}"`);
    expect(html).toContain("#12");
    expect(html).toContain("explorer-note");
    expect(render(<LatestProof snapshot={null} />)).toBe("");
    expect(render(<LatestProof snapshot={{ ...SNAPSHOT, pairs: [] }} />)).toBe("");
  });
});

describe("Press on open", () => {
  const fakeHistory = (state: unknown) => {
    const h = { state, replaceState: (s: unknown) => void (h.state = s) };
    return h;
  };

  it("hands the request over once, then clears it", () => {
    const h = fakeHistory(pressRequest("retire"));
    expect(takePressRequest(h)).toBe("retire");
    expect(h.state).toBeNull();
    expect(takePressRequest(h)).toBeNull();
  });

  it("ignores an empty state and an unknown action", () => {
    expect(takePressRequest(fakeHistory(null))).toBeNull();
    expect(takePressRequest(fakeHistory({ mentariPress: "drain" }))).toBeNull();
  });
});
