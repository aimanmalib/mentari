import { describe, expect, it } from "vitest";
import sample from "../fixtures/sample.json";
import { parseEvidence, recheckCase, type EvidenceCase } from "../src/data/evidence.js";
import { explorer } from "../src/data/explorer.js";
import { evidenceCases } from "../src/data/evidenceSource.js";

const CASE: EvidenceCase = { id: "B", expect: "revert", evm_tx: "0xabc", height: 7, receipts: { before: 1, after: 1 }, retirements: null };

describe("parseEvidence", () => {
  it("reads `{ cases }` or a bare list and skips incomplete entries", () => {
    const raw = [
      { id: "A", expect: "success", evm_tx: "0x1", height: 3, receipts: { before: 1, after: 2 } },
      { id: "B", expect: "maybe", evm_tx: "0x2" },
      { id: "C", expect: "revert" },
      "junk",
    ];
    expect(parseEvidence({ cases: raw })).toEqual([
      { id: "A", expect: "success", evm_tx: "0x1", height: 3, receipts: { before: 1, after: 2 }, retirements: null },
    ]);
    expect(parseEvidence(raw)).toHaveLength(1);
    expect(parseEvidence(null)).toEqual([]);
  });

  it("gives every demo button a sample case to fall back on", () => {
    expect(evidenceCases("sample").map((c) => c.id)).toEqual(["A", "B", "C", "D"]);
    expect(parseEvidence((sample as { cases: unknown[] }).cases)).toHaveLength(4);
  });
});

describe("recheckCase", () => {
  it("confirms when the chain shows the recorded status", async () => {
    expect(await recheckCase(CASE, async () => "reverted")).toBe("confirmed");
    expect(await recheckCase({ ...CASE, expect: "success" }, async () => "success")).toBe("confirmed");
  });

  it("says differs when the status is not the recorded one or the transaction is unknown", async () => {
    expect(await recheckCase(CASE, async () => "success")).toBe("differs");
    expect(await recheckCase(CASE, async () => null)).toBe("differs");
  });

  it("says unreadable when the node fails, and sample when there is no chain", async () => {
    expect(
      await recheckCase(CASE, async () => {
        throw new Error("timeout");
      }),
    ).toBe("unreadable");
    expect(await recheckCase(CASE, null)).toBe("sample");
  });
});

describe("explorer", () => {
  it("fills the URL templates and encodes the values", () => {
    const x = explorer({ tx: "https://x.test/tx/{hash}", block: "https://x.test/block/{height}", address: "https://x.test/a/{address}" });
    expect(x.tx("0xab")).toBe("https://x.test/tx/0xab");
    expect(x.block(12)).toBe("https://x.test/block/12");
    expect(x.address("a/b?c")).toBe("https://x.test/a/a%2Fb%3Fc");
  });
});
