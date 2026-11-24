import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import guard from "../../config/stale-phrases.json" with { type: "json" };

const repoDir = join(import.meta.dirname, "..", "..");

/** True when evidence/ records at least one retirement that added a receipt, on testnet or on the live site. */
export function retirementRecorded(testnet: unknown, live: unknown): boolean {
  const cases = (testnet as { cases?: { status?: string; receipts?: { before: number; after: number } }[] })?.cases ?? [];
  const runs = (live as { runs?: { action?: string; asExpected?: boolean }[] })?.runs ?? [];
  return (
    cases.some((c) => c.status === "success" && c.receipts !== undefined && c.receipts.after > c.receipts.before) ||
    runs.some((r) => r.action === "retire" && r.asExpected === true)
  );
}

/** Every `file: phrase` hit in the given texts. */
export function staleHits(files: { path: string; text: string }[], phrases: string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    const lower = f.text.toLowerCase();
    for (const p of phrases) if (lower.includes(p.toLowerCase())) hits.push(`${f.path}: ${p}`);
  }
  return hits;
}

function scannedFiles(): { path: string; text: string }[] {
  const skip = new Set(guard.skip);
  const out: { path: string; text: string }[] = [];
  const walk = (abs: string) => {
    const rel = relative(repoDir, abs);
    if (skip.has(rel) || rel.split("/").includes("node_modules")) return;
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs)) walk(join(abs, name));
    } else if (guard.extensions.includes(extname(abs))) {
      out.push({ path: rel, text: readFileSync(abs, "utf8") });
    }
  };
  for (const entry of guard.scan) {
    const abs = join(repoDir, entry);
    if (existsSync(abs)) walk(abs);
  }
  return out;
}

const readJson = (rel: string): unknown => JSON.parse(readFileSync(join(repoDir, rel), "utf8"));

describe("stale phrases", () => {
  it("finds a phrase in any case and names the file", () => {
    const hits = staleHits(
      [
        { path: "a.md", text: "Status: NO RETIREMENTS YET." },
        { path: "b.md", text: "Retired 16 times." },
      ],
      guard.phrases,
    );
    expect(hits).toEqual(["a.md: No retirements yet"]);
  });

  it("counts a retirement only when one added a receipt", () => {
    expect(retirementRecorded({ cases: [{ status: "reverted", receipts: { before: 8, after: 8 } }] }, {})).toBe(false);
    expect(retirementRecorded({ cases: [{ status: "success", receipts: { before: 7, after: 8 } }] }, {})).toBe(true);
    expect(retirementRecorded({}, { runs: [{ action: "retire", asExpected: true }] })).toBe(true);
    expect(retirementRecorded({}, { runs: [{ action: "case-b", asExpected: true }] })).toBe(false);
  });

  it("scans the READMEs, the slides and the site text", () => {
    const paths = scannedFiles().map((f) => f.path);
    for (const must of ["README.md", "README.ms.md", "deck/kandungan.json", "web/locales/en.json", "web/locales/ms.json"]) {
      expect(paths).toContain(must);
    }
    expect(paths.some((p) => p.startsWith("docs/decisions/"))).toBe(false);
  });

  it("no scanned file says the testnet work is still to come, now that evidence/ records retirements", () => {
    expect(retirementRecorded(readJson("evidence/testnet.json"), readJson("evidence/live.json"))).toBe(true);
    expect(staleHits(scannedFiles(), guard.phrases)).toEqual([]);
  });
});
