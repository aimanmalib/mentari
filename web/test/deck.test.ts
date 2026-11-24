import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The slides are generated from deck/kandungan.json by the judge-pack deck engine, which records what it printed in
// deck/JANA.json. These tests keep the slide numbers in step with the README and catch a hand edit that was never
// printed again.
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const sha256 = (path: string) => createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex");

interface Slide {
  jenis?: string;
  angka?: { nilai: string; label: string }[];
}

function deckStats(content: { slaid: Slide[] }): Map<string, string> {
  const stats = new Map<string, string>();
  for (const slide of content.slaid) {
    if (slide.jenis !== "angka") continue;
    for (const { nilai, label } of slide.angka ?? []) stats.set(label, nilai);
  }
  return stats;
}

function readmeCount(readme: string, suite: string): string {
  const row = readme.split("\n").find((line) => line.startsWith(`| ${suite} |`));
  const n = row?.split("|")[2]?.match(/(\d+) passed/)?.[1];
  if (!n) throw new Error(`no count for ${suite} in README.md`);
  return n;
}

describe("deck stats", () => {
  const stats = deckStats(JSON.parse(read("deck/kandungan.json")));
  const readme = read("README.md");

  it("finds the stat tiles on the slides", () => {
    expect(stats.size).toBeGreaterThanOrEqual(5);
  });

  it.each([
    ["Foundry tests, including fuzz and invariants", "Foundry, `contracts/test/`"],
    ["server tests (vitest)", "vitest, `server/test/`"],
    ["site tests (vitest)", "vitest, `web/test/`"],
    ["browser tests, Chromium and WebKit", "Playwright, `web/e2e/`"],
  ])("'%s' matches the README row %s", (label, suite) => {
    expect(stats.get(label)).toBe(readmeCount(readme, suite));
  });

  it("the coverage tile matches the README", () => {
    const cov = readme.match(/line coverage of `contracts\/src` (\d+) %/)?.[1];
    expect(stats.get("line coverage of contracts/src")).toBe(`${cov} %`);
  });
});

describe("generated deck", () => {
  const record = JSON.parse(read("deck/JANA.json"));

  it("the PDF in the repository is the one the engine printed", () => {
    expect(record.pdf).toBe("docs/deck.pdf");
    expect(read(record.pdf).slice(0, 5)).toBe("%PDF-");
    expect(sha256(record.pdf)).toBe(record.sha256_pdf);
  });

  it("the slides were printed from the current deck/kandungan.json", () => {
    expect(record.kandungan.fail).toBe("deck/kandungan.json");
    expect(sha256(record.kandungan.fail)).toBe(record.kandungan.sha256);
    expect(record.slaid).toBe(JSON.parse(read(record.kandungan.fail)).slaid.length);
  });
});

// AI_USAGE.md counts the builder sessions and lists every session that was not accepted in a table. The sentence, the
// table and the AI usage slide must agree.
function sessionCounts(text: string) {
  const flat = text.replace(/\s+/g, " ");
  const num = (re: RegExp) => {
    const n = flat.match(re)?.[1];
    if (!n) throw new Error(`no match for ${re}`);
    return Number(n);
  };
  return {
    total: num(/the builder ran (\d+) sessions/),
    accepted: num(/(\d+) were accepted/),
    rejected: num(/(\d+) were not(?: accepted)?\b/),
    waited: num(/(\d+) stopped/),
  };
}

describe("AI usage session counts", () => {
  const usage = read("AI_USAGE.md");
  const counts = sessionCounts(usage);
  const lines = usage.split("\n");
  const head = lines.findIndex((line) => line.startsWith("| Slice | Caught by |"));
  const rows = lines.slice(head + 2).filter((line, i, all) => all.slice(0, i + 1).every((l) => l.startsWith("| ")));

  it("the session outcomes add up to the total", () => {
    expect(counts.accepted + counts.rejected + counts.waited).toBe(counts.total);
  });

  it("the table has one row for every session that was not accepted", () => {
    expect(head).toBeGreaterThan(0);
    expect(rows.length).toBe(counts.rejected);
  });

  it("the AI usage slide gives the same counts", () => {
    const slides = read("deck/kandungan.json");
    const point = slides.match(/"Generated work\.[^"]*"/)?.[0];
    expect(point).toBeDefined();
    expect(sessionCounts(point ?? "")).toEqual(counts);
  });
});
