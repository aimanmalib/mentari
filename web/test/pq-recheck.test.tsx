import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import ms from "../locales/ms.json";
import { PqRecheck, PqRecheckView, type PqResult } from "../src/components/PqRecheck.js";
import { verifyNow } from "../src/data/pqCheck.js";
import { checkReadings, type ReadingTx } from "../src/data/readings.js";
import { I18nProvider } from "../src/i18n/I18n.js";
import frozen from "./fixtures/readings.json";

const fixture = frozen as { chainId: number; contract: string; readings: ReadingTx[]; meters: Record<string, string>; keys: Record<string, `0x${string}`> };
const render = (el: ReactElement, locale = "en") => renderToStaticMarkup(<I18nProvider locale={locale}>{el}</I18nProvider>);

async function result(attested = true): Promise<PqResult> {
  const chain = {
    meterOf: async (id: number) => fixture.meters[String(id)] ?? null,
    keyOf: async (a: string) => fixture.keys[a] ?? null,
    attested: async () => attested,
  };
  const checks = await checkReadings(fixture.readings, chain, async (j) => verifyNow(j), { chainId: fixture.chainId, contract: fixture.contract });
  return { checks, ms: 12.4 };
}

describe("Post-quantum re-check on Verify", () => {
  it("has its own heading, starts by checking, and sits on the live Verify page", () => {
    const html = render(<PqRecheck />);
    expect(html).toContain('id="pq-title"');
    expect(html).toContain(en.verify.pq.title);
    expect(html).toContain(en.verify.pq.loading);
    expect(readFileSync(new URL("../src/pages/Verify.tsx", import.meta.url), "utf8")).toContain('siteMode === "live" && <PqRecheck />');
  });

  it("shows each real reading as valid, the agreement, and a Cosmos link per reading", async () => {
    const html = render(<PqRecheckView result={await result()} tampered={{ status: "idle" }} onTamper={() => {}} />);
    expect(html).toContain("3 of 3 signatures valid in your browser");
    expect(html).toContain(en.verify.pq.agree);
    expect(html.match(/check-ok/g)).toHaveLength(6);
    for (const r of fixture.readings) expect(html).toContain(`/tx/${r.cosmosTx}`);
    expect(html).not.toMatch(/tx\/0x/);
    expect(html).toContain("Checked in 12 ms");
  });

  it("says the browser and the chain disagree when the chain has no record of valid readings", async () => {
    const html = render(<PqRecheckView result={await result(false)} tampered={{ status: "idle" }} onTamper={() => {}} />);
    expect(html).toContain(en.verify.pq.disagree);
    expect(html).toContain("verify-bad");
  });

  it("reports the tampered copy and speaks Malay", async () => {
    const r = await result();
    const html = render(<PqRecheckView result={r} tampered={{ status: "done", accepted: false }} onTamper={() => {}} />, "ms");
    expect(html).toContain(ms.verify.pq.tamperRejected);
    expect(html).toContain("3 daripada 3 tandatangan sah");
    const broken = render(<PqRecheckView result={r} tampered={{ status: "done", accepted: true }} onTamper={() => {}} />);
    expect(broken).toContain(en.verify.pq.tamperAccepted);
  });

  it("says so when there are no readings yet", () => {
    expect(render(<PqRecheckView result={{ checks: [], ms: 0 }} tampered={{ status: "idle" }} onTamper={() => {}} />)).toContain(en.verify.pq.empty);
  });
});
