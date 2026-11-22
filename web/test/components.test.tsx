import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoResult, CountsBoard } from "../src/components/DemoResult.js";
import { RecordPair } from "../src/components/RecordPair.js";
import { VerifyResult } from "../src/components/VerifyReport.js";
import { siteConfig } from "../src/config.js";
import type { DemoOutcome } from "../src/data/demo.js";
import type { RetirementRecord } from "../src/data/records.js";
import { I18nProvider } from "../src/i18n/I18n.js";
import { DemoStatusLine } from "../src/pages/TryIt.js";
import { RetirementsList, fromParam } from "../src/pages/Retirements.js";

const render = (el: ReactElement, locale = "en") => renderToStaticMarkup(<I18nProvider locale={locale}>{el}</I18nProvider>);
const ENTITIES: Record<string, string> = { "&#x27;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">" };
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&quot;|&amp;|&lt;|&gt;/g, (e) => ENTITIES[e]!)
    .replace(/\s+/g, " ");

const HASH = `0x${"cd".repeat(32)}`;
const HOLDER = "0x7d3c000000000000000000000000000000000007";
const RECORD: RetirementRecord = {
  retirement: { n: 7, holder: HOLDER, wh: 500n, receiptId: 42, timestamp: 1795000000 },
  receipt: { id: 42, sender: "qor1tcdqqqqqqqqqqqqqqqqqqqqqqqqqpsx755prn6", note: `MTR1 n=7 wh=500 by=${HOLDER} m=demo`, height: 10501234 },
  evmTx: HASH,
  check: { n: 7, receiptId: 42, ok: true, problems: [] },
};
const explorerOrigin = new URL(siteConfig.explorer.tx.replace("{hash}", "x")).origin;

describe("RecordPair", () => {
  it("shows both sides with explorer links for the transaction, the holder and the receipt's block", () => {
    const html = render(<RecordPair record={RECORD} />);
    expect(html).toContain(siteConfig.explorer.tx.replace("{hash}", HASH));
    expect(html).toContain(siteConfig.explorer.address.replace("{address}", HOLDER));
    expect(html).toContain(siteConfig.explorer.block.replace("{height}", "10501234"));
    expect(html).toContain(explorerOrigin);
    expect(html).toContain('rel="noopener noreferrer"');
    expect(text(html)).toContain(RECORD.receipt!.note);
    expect(html).toContain('href="/verify?n=7"');
    expect(html).toContain("pair-ok");
  });

  it("says when the transaction or the receipt is missing, and names the problem", () => {
    const html = text(
      render(
        <RecordPair
          record={{ ...RECORD, receipt: null, evmTx: null, check: { ...RECORD.check, ok: false, problems: ["missing-receipt"] } }}
          showVerify={false}
        />,
      ),
    );
    expect(html).toContain("The EVM node did not return it");
    expect(html).toContain("The Native ledger has no receipt with this id.");
    expect(html).toContain("no receipt");
    expect(html).not.toContain("Check this one");
  });

  it("renders in Bahasa Melayu", () => {
    expect(text(render(<RecordPair record={RECORD} />, "ms"))).toContain("Persaraan #7");
  });

  it("keeps the date and the time whole, so a narrow column never leaves the hour marker alone on a line", () => {
    const css = readFileSync(fileURLToPath(new URL("../src/styles/records.css", import.meta.url)), "utf8");
    expect(css).toMatch(/\.pair-time span\s*\{[^}]*white-space:\s*nowrap/);
    for (const locale of ["en", "ms"]) {
      const html = render(<RecordPair record={RECORD} />, locale);
      const time = html.match(/<time class="pair-time" dateTime="([^"]+)"><span>([^<]+)<\/span> <span>([^<]+)<\/span><\/time>/);
      expect(time, locale).not.toBeNull();
      expect(time![1]).toBe(new Date(RECORD.retirement.timestamp * 1000).toISOString());
      expect(time![2]).toMatch(/2026/);
      expect(time![3]).toMatch(/\d{1,2}[:.]\d{2}/);
    }
  });
});

describe("VerifyResult", () => {
  const checks = [
    { code: "receipt-exists", ok: true },
    { code: "same-id", ok: true },
    { code: "sender", ok: true },
    { code: "note", ok: false },
  ] as const;

  it("lists every check with its result and the verdict", () => {
    const html = text(render(<VerifyResult report={{ state: "checked", query: { kind: "n", value: 7 }, record: RECORD, checks: [...checks], ok: false }} />));
    expect(html).toContain("The ledgers disagree");
    expect(html).toContain("The receipt note names this retirement, amount and holder failed");
    expect(html).toContain("The Native ledger has the receipt passed");
  });

  it("explains a receipt the contract did not write", () => {
    const html = text(
      render(<VerifyResult report={{ state: "not-mentari", query: { kind: "receipt", value: 9 }, receipt: { ...RECORD.receipt!, sender: "qor1other0000000000000000000xyz" }, contractNative: "qor1x" }} />),
    );
    expect(html).toContain("Receipt #9");
    expect(html).toContain("the Mentari contract did not write it");
  });

  it("explains a number that does not exist yet", () => {
    expect(text(render(<VerifyResult report={{ state: "not-found", query: { kind: "n", value: 99 } }} />))).toContain(
      "The contract has no retirement with this number yet.",
    );
  });
});

describe("Try it", () => {
  const sent: DemoOutcome = {
    kind: "sent",
    action: "case-b",
    expect: "revert",
    evmTx: HASH,
    evmStatus: "reverted",
    receipts: { before: 6, after: 6 },
    retirements: { before: 3, after: 3 },
    asExpected: true,
    evidenceCase: "B",
  };

  it("shows both lanes before and after, and that nothing changed on a failure case", () => {
    const html = text(render(<DemoResult outcome={sent} recorded={null} recheck={null} />));
    expect(html).toContain("As expected");
    expect(html).toContain("Neither ledger should change.");
    expect(html).toMatch(/EVM retirements 3 → becomes 3 Unchanged/);
    expect(html).toMatch(/Native receipts 6 → becomes 6 Unchanged/);
    expect(html).toContain("Transaction reverted:");
  });

  it("shows the change on a successful retirement", () => {
    expect(text(render(<CountsBoard retirements={{ before: 3, after: 4 }} receipts={{ before: 6, after: 7 }} />))).toContain("Changed by +1");
  });

  it("falls back to the recorded case with the reason, the wait and the re-check result", () => {
    const html = text(
      render(
        <DemoResult
          outcome={{ kind: "fallback", action: "retire", reason: "ip-limit", retryAfterSeconds: 90, evidenceCase: "A" }}
          recorded={{ id: "A", expect: "success", evm_tx: HASH, height: 1, receipts: { before: 1, after: 2 }, retirements: { before: 0, after: 1 } }}
          recheck="confirmed"
        />,
      ),
    );
    expect(html).toContain("You have used this hour's live sends.");
    expect(html).toContain("Try again in about 2 min.");
    expect(html).toContain("recorded testnet case A");
    expect(html).toContain("testnet shows the same result");
  });

  it("says when there is no recorded case yet", () => {
    const html = text(render(<DemoResult outcome={{ kind: "fallback", action: "case-d", reason: "unreachable", evidenceCase: "D" }} recorded={null} recheck={null} />));
    expect(html).toContain("The demo server did not answer.");
    expect(html).toContain("No recorded case yet.");
  });

  it("states whether live sends are open", () => {
    expect(text(render(<DemoStatusLine status={{ enabled: true, ready: true, busy: false, remainingToday: 12, remainingForYou: 3 }} />))).toContain(
      "12 left today, 3 left for you this hour",
    );
    expect(text(render(<DemoStatusLine status={null} />))).toContain("recorded testnet case instead");
    expect(text(render(<DemoStatusLine status={{ enabled: false, ready: true, busy: false, remainingToday: 0, remainingForYou: 0 }} />))).toContain(
      "switched off",
    );
  });
});

describe("Retirements list", () => {
  it("offers the demo when nothing is retired yet", () => {
    const html = render(<RetirementsList page={{ total: 0, contractNative: "qor1x", records: [], olderFrom: null }} />);
    expect(html).toContain('href="/try"');
  });

  it("links to the newest and the next older page", () => {
    const html = render(<RetirementsList page={{ total: 30, contractNative: "qor1x", records: [RECORD], olderFrom: 6 }} />);
    expect(html).toContain('href="/retirements?from=6"');
    expect(html).toContain('href="/retirements"');
    expect(text(html)).toContain("Showing #7 to #7 of 30");
  });

  it("reads ?from= as a positive whole number only", () => {
    expect(fromParam("?from=12")).toBe(12);
    expect(fromParam("?from=0")).toBeNull();
    expect(fromParam("?from=abc")).toBeNull();
    expect(fromParam("")).toBeNull();
  });
});
