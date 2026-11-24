import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import live from "../../evidence/live.json";
import testnet from "../../evidence/testnet.json";
import en from "../locales/en.json";
import ms from "../locales/ms.json";
import { NativeFinding } from "../src/components/NativeFinding.js";
import { siteConfig } from "../src/config.js";
import { HowItWorks } from "../src/pages/HowItWorks.js";
import { I18nProvider } from "../src/i18n/I18n.js";

const render = (el: ReactElement, locale = "en") => renderToStaticMarkup(<I18nProvider locale={locale}>{el}</I18nProvider>);
const COSMOS_HASH = /^[0-9A-F]{64}$/;

interface Step {
  function?: string;
  cosmos_tx?: string;
  accepted?: boolean;
  window_before?: string;
  receipts?: { before: number; after: number };
}

describe("Native lane finding on How it works", () => {
  it("sits on the How it works page with its own heading", () => {
    const html = render(<HowItWorks />);
    expect(html).toContain('id="native-title"');
    expect(html).toContain(en.how.native.title);
  });

  it("quotes the docs and links the section it quotes", () => {
    const { docsUrl } = siteConfig.nativeFinding;
    expect(docsUrl).toMatch(/^https:\/\/docs\.qorechain\.io\/.+#native-to-evm$/);
    for (const [locale, text] of [["en", en], ["ms", ms]] as const) {
      const html = render(<NativeFinding />, locale);
      expect(html).toContain(`href="${docsUrl}"`);
      expect(html).toContain("Not yet tested against the live network");
      expect(html).toContain(text.how.native.docsCite);
    }
  });

  it("draws the route as an SVG with a label in both languages, not CSS 3D", () => {
    for (const [locale, text] of [["en", en], ["ms", ms]] as const) {
      const html = render(<NativeFinding />, locale);
      expect(html).toContain(`<svg viewBox=`);
      expect(html).toContain(`role="img" aria-label="${text.how.native.diagramLabel}"`);
      for (const label of [text.how.native.d.account, text.how.native.d.contract, text.how.native.d.book]) {
        expect(html).toContain(label);
      }
    }
    const css = readFileSync(new URL("../src/styles/native.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/perspective|backdrop-filter|filter:\s*blur/);
  });

  it("links two Cosmos hashes on the explorer, never an EVM hash", () => {
    const html = render(<NativeFinding />);
    const hrefs = [...html.matchAll(/href="(https:\/\/explore\.qore\.network\/tx\/[^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toHaveLength(2);
    for (const href of hrefs) expect(href!.split("/tx/")[1]).toMatch(COSMOS_HASH);
    expect(html).not.toContain("tx/0x");
  });

  it("uses case H's retire step: accepted, no EVM window, one new receipt", () => {
    const h = (testnet as { cases: { id: string; steps?: Step[] }[] }).cases.find((c) => c.id === "H");
    const step = h?.steps?.find((s) => s.cosmos_tx === siteConfig.nativeFinding.caseTx);
    expect(step?.function).toBe("retire");
    expect(step?.accepted).toBe(true);
    expect(step?.window_before).toBe("closed");
    expect(step!.receipts!.after - step!.receipts!.before).toBe(1);
  });

  it("uses a recorded Retire now press that succeeded", () => {
    const runs = (live as { runs: { action?: string; cosmosTx?: string; txStatus?: string; asExpected?: boolean }[] }).runs;
    const press = runs.find((r) => r.cosmosTx === siteConfig.nativeFinding.retireTx);
    expect(press?.action).toBe("retire");
    expect(press?.txStatus).toBe("success");
    expect(press?.asExpected).toBe(true);
  });
});
