import { describe, expect, it } from "vitest";
import type { BookReader, Receipt } from "../src/book.js";
import { formatReport, noteFor, runVerify, summarise, type EvmReader, type RecordedCase, type TxResult, type VerifyInput } from "../src/verify.js";

const MENTARI = "0x00000000000000000000000000000000000000aa";
const PROBE = "0x00000000000000000000000000000000000000bb";
const NATIVE = "qor1mentari";
const BOOK = "qor1book";
const HOLDER = "0x00000000000000000000000000000000000000Cc";

interface World {
  retirements: { holder: string; wh: bigint; receiptId: bigint }[];
  receipts: Map<number, Receipt>;
  totals: { minted: bigint; retired: bigint; supply: bigint };
  txs: Map<string, TxResult>;
  /** Receipts count by block height; a missing height throws like a pruned node. */
  counts: Map<number, number>;
  cosmos: Map<string, string>;
  code: Set<string>;
  book: string;
}

/** A consistent chain: two retirements (500 + 250 Wh), case A succeeded at block 100, case B reverted at block 200. */
function world(): World {
  const retirements = [
    { holder: HOLDER, wh: 500n, receiptId: 8n },
    { holder: HOLDER, wh: 250n, receiptId: 11n },
  ];
  const receipts = new Map<number, Receipt>(
    retirements.map((r, i) => [Number(r.receiptId), { id: Number(r.receiptId), sender: NATIVE, note: `${noteFor(BigInt(i + 1), r.wh, r.holder)}memo`, height: 1 }]),
  );
  return {
    retirements,
    receipts,
    totals: { minted: 1000n, retired: 750n, supply: 250n },
    txs: new Map([
      ["0xa", { status: "success", to: MENTARI }],
      ["0xb", { status: "reverted", to: PROBE }],
    ]),
    counts: new Map([[99, 7], [100, 8], [199, 8], [200, 8]]),
    cosmos: new Map([["0xa", "COSMOSA"], ["0xb", "COSMOSB"]]),
    code: new Set([MENTARI, PROBE]),
    book: BOOK,
  };
}

const CASES: RecordedCase[] = [
  { id: "A", expect: "success", contract: MENTARI, evm_tx: "0xa", cosmos_tx: "COSMOSA", height: 100, receipt: { id: 8, sender: NATIVE, note: `${noteFor(1n, 500n, HOLDER)}memo` } },
  { id: "B", expect: "revert", contract: PROBE, evm_tx: "0xb", cosmos_tx: "COSMOSB", height: 200 },
];

const input: VerifyInput = { mentari: MENTARI, atomicityProbe: PROBE, mentariNative: NATIVE, receiptsBook: BOOK, cases: CASES, concurrency: 2 };

function readers(w: World): { evm: EvmReader; book: BookReader } {
  return {
    evm: {
      hasCode: async (a) => w.code.has(a),
      receiptsBook: async () => w.book,
      retirementsCount: async () => BigInt(w.retirements.length),
      retirement: async (n) => w.retirements[Number(n) - 1]!,
      totals: async () => w.totals,
      tx: async (h) => w.txs.get(h) ?? null,
    },
    book: {
      countAt: async (h) => {
        const c = w.counts.get(h);
        if (c === undefined) throw new Error("HTTP 500");
        return c;
      },
      receipt: async (id) => {
        const r = w.receipts.get(id);
        if (!r) throw new Error("HTTP 500");
        return r;
      },
      cosmosTxOf: async (h) => w.cosmos.get(h) ?? null,
    },
  };
}

async function run(change: (w: World) => void = () => {}) {
  const w = world();
  change(w);
  const { evm, book } = readers(w);
  const checks = await runVerify(evm, book, input);
  return { checks, summary: summarise(checks), failed: checks.filter((c) => c.outcome === "fail").map((c) => c.name) };
}

describe("verify", () => {
  it("passes every check on a consistent chain", async () => {
    const { summary, checks } = await run();
    expect(summary).toEqual({ checks: checks.length, passed: checks.length, failed: 0, unavailable: 0 });
    expect(checks.length).toBe(3 + 2 + 1 + 2 + 4 + 3);
  });

  it("fails a retirement whose receipt has another sender, another amount or is missing", async () => {
    expect((await run((w) => (w.receipts.get(8)!.sender = "qor1other"))).failed).toEqual(["retirement 1 matches receipt 8", "case A receipt 8 as recorded"]);
    expect((await run((w) => (w.retirements[1]!.wh = 251n))).failed).toContain("retirement 2 matches receipt 11");
    expect((await run((w) => w.receipts.delete(11))).failed).toEqual(["retirement 2 matches receipt 11"]);
  });

  it("fails when receipt ids do not rise or the totals do not add up", async () => {
    expect((await run((w) => (w.retirements[1]!.receiptId = 8n))).failed).toContain("receipt ids rise with the retirement number");
    expect((await run((w) => (w.totals.supply = 251n))).failed).toEqual(["minted - retired = supply"]);
    expect((await run((w) => (w.totals = { minted: 1000n, retired: 700n, supply: 300n }))).failed).toEqual(["the retirements add up to retired"]);
  });

  it("fails a revert case that succeeded, went elsewhere, or moved the receipts book", async () => {
    expect((await run((w) => w.txs.set("0xb", { status: "success", to: PROBE }))).failed).toEqual(["case B EVM transaction reverted"]);
    expect((await run((w) => w.txs.set("0xb", { status: "reverted", to: MENTARI }))).failed).toEqual(["case B EVM transaction reverted"]);
    expect((await run((w) => w.txs.delete("0xb"))).failed).toEqual(["case B EVM transaction reverted"]);
    expect((await run((w) => w.counts.set(200, 9))).failed).toEqual(["case B receipts book unchanged at block 200"]);
    expect((await run((w) => w.counts.set(100, 7))).failed).toEqual(["case A receipts book gained a receipt at block 100"]);
  });

  it("fails a Cosmos hash that differs from the evidence and marks unanswered reads as unavailable", async () => {
    expect((await run((w) => w.cosmos.set("0xb", "OTHER"))).failed).toEqual(["case B Cosmos transaction"]);
    const pruned = await run((w) => {
      w.counts.delete(199);
      w.cosmos.delete("0xa");
    });
    expect(pruned.summary.failed).toBe(0);
    expect(pruned.summary.unavailable).toBe(2);
  });

  it("fails when a contract has no code or writes to another book", async () => {
    expect((await run((w) => w.code.delete(PROBE))).failed).toEqual([`AtomicityProbe has code at ${PROBE}`]);
    expect((await run((w) => (w.book = "qor1elsewhere"))).failed).toEqual(["Mentari writes to the configured receipts book"]);
  });

  it("prints one line per check and the count", async () => {
    const { checks } = await run((w) => w.receipts.delete(11));
    const text = formatReport(checks);
    expect(text.split("\n")).toHaveLength(checks.length + 2);
    expect(text).toContain(`FAIL retirements retirement 2 matches receipt 11 (receipt not read: HTTP 500)`);
    expect(text.trim().split("\n").at(-1)).toBe(`${checks.length - 1} of ${checks.length} checks passed, 1 failed.`);
  });
});
