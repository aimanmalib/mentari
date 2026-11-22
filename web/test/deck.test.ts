import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The slides repeat the test counts from the README. This keeps the two from drifting apart.
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

function deckStats(html: string): Map<string, string> {
  const stats = new Map<string, string>();
  for (const m of html.matchAll(/<div class="stat"><b>([^<]+)<\/b><span>([^<]+)<\/span><\/div>/g)) {
    stats.set(m[2]!, m[1]!);
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
  const stats = deckStats(read("deck/index.html"));
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
