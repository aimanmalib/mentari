import { describe, expect, it } from "vitest";
import type { BookReader, Receipt } from "../src/book.js";
import { formatReport, noteFor, runVerify, summarise, type EvmReader, type RecordedCase, type RecordedEntry, type TxResult, type VerifyInput } from "../src/verify.js";

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
  /** Cosmos transactions by hash: result code and block. */
  native: Map<string, { code: number; height: number }>;
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
    native: new Map(),
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
      cosmosTx: async (h) => w.native.get(h) ?? null,
    },
  };
}

async function run(change: (w: World) => void = () => {}, cases: VerifyInput["cases"] = CASES) {
  const w = world();
  change(w);
  const { evm, book } = readers(w);
  const checks = await runVerify(evm, book, { ...input, cases });
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

  describe("case H", () => {
    const H: RecordedEntry = {
      id: "H",
      steps: [
        { step: 1, function: "attest", cosmos_tx: "H1", height: 300, accepted: false },
        { step: 2, function: "retire", cosmos_tx: "H2", height: 400, accepted: true },
      ],
    };
    const chainH = (w: World) => {
      w.native.set("H1", { code: 14, height: 300 });
      w.native.set("H2", { code: 0, height: 400 });
      for (const [h, c] of [[299, 8], [300, 8], [399, 8], [400, 9]] as const) w.counts.set(h, c);
    };
    const runH = (change: (w: World) => void = () => {}) =>
      run((w) => {
        chainH(w);
        change(w);
      }, [...CASES, H]);

    it("passes when each step's Cosmos transaction and the receipts book match the record", async () => {
      const { summary, checks } = await runH();
      expect(summary.failed).toBe(0);
      expect(checks.filter((c) => c.name.startsWith("case H")).map((c) => c.name)).toEqual([
        "case H step 1 attest Cosmos transaction not accepted",
        "case H step 1 attest receipts book unchanged at block 300",
        "case H step 2 retire Cosmos transaction accepted",
        "case H step 2 retire receipts book gained a receipt at block 400",
      ]);
    });

    it("fails a step whose outcome or block differs, or whose book count does not match", async () => {
      expect((await runH((w) => w.native.set("H1", { code: 0, height: 300 }))).failed).toEqual(["case H step 1 attest Cosmos transaction not accepted"]);
      expect((await runH((w) => w.native.set("H2", { code: 0, height: 401 }))).failed).toEqual(["case H step 2 retire Cosmos transaction accepted"]);
      expect((await runH((w) => w.counts.set(300, 9))).failed).toEqual(["case H step 1 attest receipts book unchanged at block 300"]);
      expect((await runH((w) => w.counts.set(400, 10))).failed).toEqual(["case H step 2 retire receipts book gained a receipt at block 400"]);
    });

    it("reports a transaction the node no longer finds as unavailable", async () => {
      const r = await runH((w) => w.native.delete("H2"));
      expect([r.summary.failed, r.summary.unavailable]).toEqual([0, 1]);
    });
  });
  describe("case I", () => {
    const I: RecordedEntry = {
      id: "I",
      classic: { evm_tx: "0xc1", refused: true },
      steps: [{ step: 2, function: "retire", cosmos_tx: "I2", height: 500, accepted: true }],
    };
    const runI = (change: (w: World) => void = () => {}) =>
      run((w) => {
        w.native.set("I2", { code: 0, height: 500 });
        for (const [h, c] of [[499, 9], [500, 10]] as const) w.counts.set(h, c);
        change(w);
      }, [...CASES, I]);

    it("passes when the classic-key transaction has no receipt and the Native retire added one receipt", async () => {
      const { summary, checks } = await runI();
      expect(summary.failed).toBe(0);
      expect(checks.filter((c) => c.name.startsWith("case I")).map((c) => c.name)).toEqual([
        "case I classic-key EVM transaction never ran",
        "case I step 2 retire Cosmos transaction accepted",
        "case I step 2 retire receipts book gained a receipt at block 500",
      ]);
    });

    it("fails when the node has a receipt for the classic-key transaction", async () => {
      for (const status of ["success", "reverted"] as const)
        expect((await runI((w) => w.txs.set("0xc1", { status, to: MENTARI }))).failed).toEqual(["case I classic-key EVM transaction never ran"]);
    });
  });
});
