import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The top of README.md and README.ms.md answers the judging rubric: a proof table of explorer links, the five official
// criteria, and counts read from evidence/. These tests keep those links and counts tied to the evidence files, so a
// README edit cannot point a judge at an EVM hash (the explorer cannot open one) or quote a number the evidence does
// not hold.
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const json = (path: string) => JSON.parse(read(path));

// The official criteria names from the fest FAQ, quoted as they are written there.
const CRITERIA = [
  "Works as described",
  "QoreChain tech usage, verified in the repo and on chain",
  "Post-quantum correctness and security",
  "Originality",
  "Clarity, UX and documentation",
];

/** Every transaction hash the README links to on the explorer. */
export function explorerHashes(text: string): string[] {
  return [...text.matchAll(/https:\/\/explore\.qore\.network\/tx\/([^)\s"'>]+)/g)].map((m) => m[1] ?? "");
}

/** Every Cosmos transaction hash recorded in evidence/testnet.json and evidence/live.json. */
function recordedCosmosHashes(): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown, key = ""): void => {
    if (typeof value === "string" && /^(cosmos_tx|cosmosTx)$/.test(key)) found.add(value);
    else if (Array.isArray(value)) value.forEach((v) => walk(v));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(json("evidence/testnet.json"));
  walk(json("evidence/live.json"));
  return found;
}

describe.each(["README.md", "README.ms.md"])("%s", (file) => {
  const text = read(file);
  const hashes = explorerHashes(text);

  it("links only Cosmos hashes (upper case, no 0x) that evidence/ records", () => {
    expect(hashes.length).toBeGreaterThanOrEqual(10);
    const recorded = recordedCosmosHashes();
    for (const hash of hashes) {
      expect(hash, `${file}: ${hash}`).toMatch(/^[0-9A-F]{64}$/);
      expect(recorded.has(hash), `${file}: ${hash} is not in evidence/`).toBe(true);
    }
  });

  it("points every file link in its header, the demo video among them, at a file in the repo", () => {
    const head = text.split("\n## ")[0] ?? "";
    const files = [...head.matchAll(/href="([^"#:]+)"/g)].map((m) => m[1] ?? "");
    expect(files).toContain("docs/video/mentari-demo.mp4");
    for (const f of files) expect(existsSync(new URL(f, root)), `${file}: ${f}`).toBe(true);
  });

  it("names the five official criteria", () => {
    for (const name of CRITERIA) expect(text, name).toContain(`| ${name} |`);
  });

  it("quotes the verify, press and decision counts from the evidence", () => {
    const verify = json("evidence/verify.json");
    expect(verify.failed).toBe(0);
    expect(text).toMatch(new RegExp(`\\b${verify.passed} (of|daripada) ${verify.checks}\\b`));
    const runs = json("evidence/live.json").runs.length;
    expect(text).toMatch(new RegExp(`\\b${runs} (recorded presses|tekanan direkod)`));
    const decisions = readdirSync(new URL("docs/decisions/", root)).filter((f) => /^\d{4}-.*\.md$/.test(f)).length;
    expect(text).toMatch(new RegExp(`\\b${decisions} \\[(decision records|rekod keputusan)\\]`));
  });
});

describe("the two READMEs", () => {
  it("link the same transactions", () => {
    expect(explorerHashes(read("README.ms.md")).sort()).toEqual(explorerHashes(read("README.md")).sort());
  });
});
