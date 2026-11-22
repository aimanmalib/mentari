import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LIB = fileURLToPath(new URL("../lib/count-tests.sh", import.meta.url));

function count(fn: "count_vitest" | "count_forge", output: string): string {
  return execFileSync("bash", ["-c", `source "$1"; ${fn}`, "count", LIB], { input: output, encoding: "utf8" }).trim();
}

describe("count_vitest", () => {
  it("reads a single-package summary", () => {
    expect(count("count_vitest", " Test Files  2 passed (2)\n      Tests  6 passed (6)\n")).toBe("6 0");
  });

  it("adds summaries that pnpm -r prefixes with the package name", () => {
    const out = [
      "server test:  Test Files  5 passed (5)",
      "server test:       Tests  49 passed (49)",
      "scripts test:  Test Files  2 passed (2)",
      "scripts test:       Tests  6 passed (6)",
    ].join("\n");
    expect(count("count_vitest", out)).toBe("55 0");
  });

  it("reports skipped tests", () => {
    expect(count("count_vitest", "web test:       Tests  10 passed | 2 skipped (12)\n")).toBe("10 2");
  });

  it("reads coloured summaries, as printed on GitHub Actions", () => {
    const esc = "\u001b";
    const out = [
      `web test: ${esc}[2m      Tests ${esc}[22m ${esc}[1m${esc}[32m112 passed${esc}[39m${esc}[22m${esc}[90m (112)${esc}[39m`,
      `server test: ${esc}[2m      Tests ${esc}[22m ${esc}[1m${esc}[32m77 passed${esc}[39m${esc}[22m${esc}[2m | ${esc}[22m${esc}[33m1 skipped${esc}[39m${esc}[90m (78)${esc}[39m`,
    ].join("\n");
    expect(count("count_vitest", out)).toBe("189 1");
  });

  it("prints zero when no summary is present", () => {
    expect(count("count_vitest", "No test files found\n")).toBe("0 0");
  });
});

describe("count_forge", () => {
  it("takes the last total line", () => {
    const out = "Suite result: ok. 4 passed\nRan 9 test suites: 113 tests passed, 0 failed, 0 skipped (113 total tests)\n";
    expect(count("count_forge", out)).toBe("113 0");
  });
});
