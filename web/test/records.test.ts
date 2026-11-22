import { describe, expect, it } from "vitest";
import sample from "../fixtures/sample.json";
import { noteNumber, parseVerifyQuery, readRetirementsPage, verify, verifySearch } from "../src/data/records.js";
import { sampleReaders, type SampleData } from "../src/data/registry.js";
import type { Receipt } from "../src/data/types.js";

const clone = () => structuredClone(sample) as SampleData;
const contractOf = (d: SampleData) => d.contract;

/** A sample with `count` retirements 1..count, each with a matching receipt (receipt id = n + 100). */
function many(count: number): SampleData {
  const d = clone();
  const sender = d.receipts[0]!.sender;
  const holder = d.retirements[0]!.holder;
  d.retirements = [];
  d.receipts = [];
  for (let n = 1; n <= count; n++) {
    d.retirements.push({ n, holder, wh: "500", receiptId: n + 100, timestamp: 1795000000 + n, evmTx: `0x${n.toString(16).padStart(64, "0")}` });
    d.receipts.push({ id: n + 100, sender, note: `MTR1 n=${n} wh=500 by=${holder} m=x`, height: 1000 + n });
  }
  return d;
}

const opts = (d: SampleData) => ({ contract: contractOf(d), nativePrefix: "qor" });

describe("readRetirementsPage", () => {
  it("lists newest first, pairs each with its receipt and transaction, and points to the next older page", async () => {
    const d = many(5);
    const { evm, book } = sampleReaders(d);
    const page = await readRetirementsPage(evm, book, { ...opts(d), pageSize: 2 });
    expect(page.total).toBe(5);
    expect(page.records.map((r) => r.retirement.n)).toEqual([5, 4]);
    expect(page.records.every((r) => r.check.ok)).toBe(true);
    expect(page.records[0]!.receipt?.id).toBe(105);
    expect(page.records[0]!.evmTx).toBe(d.retirements[4]!.evmTx);
    expect(page.olderFrom).toBe(3);
  });

  it("starts at `from`, clamps it to the total, and ends on the last page", async () => {
    const d = many(5);
    const { evm, book } = sampleReaders(d);
    expect((await readRetirementsPage(evm, book, { ...opts(d), pageSize: 2, from: 3 })).records.map((r) => r.retirement.n)).toEqual([3, 2]);
    const last = await readRetirementsPage(evm, book, { ...opts(d), pageSize: 2, from: 1 });
    expect(last.records.map((r) => r.retirement.n)).toEqual([1]);
    expect(last.olderFrom).toBeNull();
    expect((await readRetirementsPage(evm, book, { ...opts(d), pageSize: 2, from: 99 })).records[0]!.retirement.n).toBe(5);
  });

  it("returns an empty page when nothing is retired yet", async () => {
    const d = many(0);
    const { evm, book } = sampleReaders(d);
    const page = await readRetirementsPage(evm, book, { ...opts(d), pageSize: 20 });
    expect(page).toMatchObject({ total: 0, records: [], olderFrom: null });
  });

  it("keeps the rows when the node refuses the event search, with no transaction link", async () => {
    const d = many(2);
    const { evm, book } = sampleReaders(d);
    evm.retiredTxs = async () => {
      throw new Error("block range too large");
    };
    const page = await readRetirementsPage(evm, book, { ...opts(d), pageSize: 5 });
    expect(page.records).toHaveLength(2);
    expect(page.records.map((r) => r.evmTx)).toEqual([null, null]);
  });

  it("marks a row whose receipt is missing", async () => {
    const d = many(2);
    d.receipts = d.receipts.filter((r) => r.id !== 102);
    const { evm, book } = sampleReaders(d);
    const page = await readRetirementsPage(evm, book, { ...opts(d), pageSize: 5 });
    expect(page.records[0]!.check).toMatchObject({ ok: false, problems: ["missing-receipt"] });
    expect(page.records[0]!.receipt).toBeNull();
  });
});

describe("parseVerifyQuery", () => {
  it("reads a retirement number or a receipt id", () => {
    expect(parseVerifyQuery("?n=3")).toEqual({ kind: "n", value: 3 });
    expect(parseVerifyQuery("?receipt=42")).toEqual({ kind: "receipt", value: 42 });
    expect(verifySearch({ kind: "receipt", value: 42 })).toBe("?receipt=42");
  });

  it.each(["", "?n=0", "?n=-1", "?n=1.5", "?n=abc", "?n=01", "?receipt=", "?n=99999999999999999", "?id=3"])("rejects %j", (s) => {
    expect(parseVerifyQuery(s)).toBeNull();
  });
});

describe("noteNumber", () => {
  it("reads n from a Mentari note and nothing else", () => {
    expect(noteNumber("MTR1 n=12 wh=500 by=0xab m=x")).toBe(12);
    expect(noteNumber("hello n=12 ")).toBeNull();
    expect(noteNumber("MTR1 n=0 wh=1")).toBeNull();
    expect(noteNumber("MTR1 n=12")).toBeNull();
  });
});

describe("verify", () => {
  it("checks a retirement by number: every check passes on a matching pair", async () => {
    const d = many(3);
    const { evm, book } = sampleReaders(d);
    const report = await verify(evm, book, { kind: "n", value: 2 }, opts(d));
    expect(report.state).toBe("checked");
    if (report.state !== "checked") return;
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.code)).toEqual(["receipt-exists", "same-id", "sender", "note"]);
    expect(report.record.receipt?.id).toBe(102);
  });

  it("finds the retirement from its receipt id", async () => {
    const d = many(3);
    const { evm, book } = sampleReaders(d);
    const report = await verify(evm, book, { kind: "receipt", value: 103 }, opts(d));
    expect(report.state === "checked" && report.record.retirement.n).toBe(3);
  });

  it("says not found for a number past the end or an unknown receipt", async () => {
    const d = many(3);
    const { evm, book } = sampleReaders(d);
    expect((await verify(evm, book, { kind: "n", value: 4 }, opts(d))).state).toBe("not-found");
    expect((await verify(evm, book, { kind: "receipt", value: 999 }, opts(d))).state).toBe("not-found");
  });

  it("says a receipt from another sender is not a Mentari receipt, even with a Mentari-looking note", async () => {
    const d = many(3);
    const other: Receipt = { id: 500, sender: "qor1someoneelse", note: "MTR1 n=1 wh=500 by=0x00 m=x", height: 1 };
    d.receipts.push(other);
    const { evm, book } = sampleReaders(d);
    expect((await verify(evm, book, { kind: "receipt", value: 500 }, opts(d))).state).toBe("not-mentari");
  });

  it("reports a Mentari receipt that names a retirement the contract does not have", async () => {
    const d = many(2);
    d.receipts.push({ ...d.receipts[0]!, id: 300, note: d.receipts[0]!.note.replace("n=1 ", "n=9 ") });
    const { evm, book } = sampleReaders(d);
    expect(await verify(evm, book, { kind: "receipt", value: 300 }, opts(d))).toMatchObject({ state: "orphan", n: 9 });
  });

  it("fails the id check when the receipt names a retirement that points to a different receipt", async () => {
    const d = many(2);
    // A second receipt from the contract claiming retirement 1, which points to receipt 101, not 301.
    d.receipts.push({ ...d.receipts[0]!, id: 301 });
    const { evm, book } = sampleReaders(d);
    const report = await verify(evm, book, { kind: "receipt", value: 301 }, opts(d));
    expect(report.state === "checked" && report.ok).toBe(false);
    expect(report.state === "checked" && report.checks.find((c) => c.code === "same-id")?.ok).toBe(false);
  });

  it("fails the note check when the note names another amount", async () => {
    const d = many(2);
    d.receipts[1]!.note = d.receipts[1]!.note.replace("wh=500", "wh=600");
    const { evm, book } = sampleReaders(d);
    const report = await verify(evm, book, { kind: "n", value: 2 }, opts(d));
    expect(report.state === "checked" && report.checks.filter((c) => !c.ok).map((c) => c.code)).toEqual(["note"]);
  });
});
