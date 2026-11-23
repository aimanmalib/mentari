import { describe, expect, it } from "vitest";
import type { BookReader } from "../src/book.js";
import { liveChecks, recordChecks, streakCheck, type LiveRecord, type LiveRun } from "../src/live.js";
import type { EvmReader, TxResult } from "../src/verify.js";

const MENTARI = "0x00000000000000000000000000000000000000aa";
const PROBE = "0x00000000000000000000000000000000000000bb";

const base = { at: "2026-01-01T00:00:00Z", browser: "webkit", viewport: "390x664", lang: "en", asExpected: true, consoleErrors: 0, overflowPx: 0 } as const;
const retire = (n: number, height: number): LiveRun => ({
  ...base,
  n,
  action: "retire",
  cosmosTx: `C${n}`,
  height,
  txStatus: "success",
  receipts: { before: 10 + n, after: 11 + n },
  retirements: { before: n, after: n + 1 },
});
const failure = (n: number, action: "case-b" | "case-c" | "case-d"): LiveRun => ({
  ...base,
  n,
  action,
  evmTx: `0x${n}`,
  txStatus: "reverted",
  receipts: { before: 10, after: 10 },
  retirements: { before: 1, after: 1 },
});

/** Three failures, then Retire now twice; the chain agrees with every run. */
function record(): LiveRecord {
  return { site: "https://example.test", retireStreak: 2, runs: [failure(1, "case-b"), failure(2, "case-c"), failure(3, "case-d"), retire(4, 100), retire(5, 200)] };
}

function readers(change: { txs?: Map<string, TxResult>; counts?: Map<number, number>; native?: Map<string, { code: number; height: number }> } = {}): { evm: EvmReader; book: BookReader } {
  const txs = change.txs ?? new Map<string, TxResult>([["0x1", { status: "reverted", to: PROBE }], ["0x2", { status: "reverted", to: PROBE }], ["0x3", { status: "reverted", to: PROBE }]]);
  const counts = change.counts ?? new Map([[99, 14], [100, 15], [199, 15], [200, 16]]);
  const native = change.native ?? new Map([["C4", { code: 0, height: 100 }], ["C5", { code: 0, height: 200 }]]);
  const none = async (): Promise<never> => {
    throw new Error("not used");
  };
  return {
    evm: { hasCode: none, receiptsBook: none, retirementsCount: none, retirement: none, totals: none, tx: async (h) => txs.get(h) ?? null },
    book: {
      countAt: async (h) => {
        const c = counts.get(h);
        if (c === undefined) throw new Error("HTTP 500");
        return c;
      },
      receipt: none,
      cosmosTxOf: none,
      cosmosTx: async (h) => native.get(h) ?? null,
    },
  };
}

const failed = (checks: { outcome: string; name: string }[]) => checks.filter((c) => c.outcome === "fail").map((c) => c.name);

describe("live record", () => {
  it("passes a record the chain agrees with", async () => {
    const { evm, book } = readers();
    const checks = await liveChecks(evm, book, record(), [MENTARI, PROBE]);
    expect(checks.every((c) => c.outcome === "pass")).toBe(true);
    expect(checks.length).toBe(5 + 1 + 3 + 2 * 2);
  });

  it("fails a retire that did not move both ledgers by one, and a failure that moved one", () => {
    const r = record();
    const runs = r.runs.map((x) => ({ ...x }));
    runs[0]!.receipts = { before: 10, after: 11 };
    runs[3]!.retirements = { before: 4, after: 4 };
    expect(failed(recordChecks({ ...r, runs }))).toEqual([
      "run 1 case-b (webkit 390x664 en) both ledgers unchanged",
      "run 4 retire (webkit 390x664 en) both ledgers up by one",
    ]);
  });

  it("fails a run with console errors, a page wider than the screen, or a page that said not as expected", () => {
    const r = record();
    const runs = r.runs.map((x, i) => (i === 1 ? { ...x, consoleErrors: 1 } : i === 2 ? { ...x, overflowPx: 3 } : i === 4 ? { ...x, asExpected: false } : x));
    expect(failed(recordChecks({ ...r, runs }))).toHaveLength(3);
  });

  it("counts the streak only over successful retire runs in order", () => {
    const r = record();
    expect(streakCheck(r, 2).outcome).toBe("pass");
    expect(streakCheck(r, 3)).toMatchObject({ outcome: "fail", detail: "longest run 2" });
    const broken = { ...r, runs: [...r.runs.slice(0, 4), { ...retire(5, 200), txStatus: "reverted" as const }, retire(6, 300)] };
    expect(streakCheck(broken, 2).outcome).toBe("fail");
  });

  it("fails when the chain disagrees: a failure that succeeded, a retire the book did not record, a rejected Native tx", async () => {
    const txs = new Map<string, TxResult>([["0x1", { status: "success", to: PROBE }], ["0x2", { status: "reverted", to: "0x00000000000000000000000000000000000000cc" }], ["0x3", { status: "reverted", to: PROBE }]]);
    const { evm, book } = readers({ txs, counts: new Map([[99, 14], [100, 14], [199, 15], [200, 16]]), native: new Map([["C4", { code: 0, height: 100 }], ["C5", { code: 5, height: 200 }]]) });
    expect(failed(await liveChecks(evm, book, record(), [MENTARI, PROBE]))).toEqual([
      "run 1 case-b (webkit 390x664 en) EVM transaction reverted",
      "run 2 case-c (webkit 390x664 en) EVM transaction reverted",
      "run 4 retire (webkit 390x664 en) receipts book gained a receipt at block 100",
      "run 5 retire (webkit 390x664 en) Cosmos transaction accepted",
    ]);
  });

  it("marks a transaction the node cannot find as unavailable, not passed", async () => {
    const { evm, book } = readers({ native: new Map([["C5", { code: 0, height: 200 }]]) });
    const c = (await liveChecks(evm, book, record(), [MENTARI, PROBE])).find((x) => x.name.startsWith("run 4 retire") && x.name.endsWith("accepted"));
    expect(c?.outcome).toBe("unavailable");
  });
});
