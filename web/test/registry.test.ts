import { describe, expect, it } from "vitest";
import sample from "../fixtures/sample.json";
import { dataMode } from "../src/data/load.js";
import { readRegistry, sampleReaders, type SampleData } from "../src/data/registry.js";

const SYSTEMS = [
  { id: 1, label: "A" },
  { id: 2, label: "B" },
  { id: 9, label: "Z" },
];
const OPTS = { contract: (sample as SampleData).contract, nativePrefix: "qor", systems: SYSTEMS, checkLatest: 2, now: () => 1234 };

function clone(): SampleData {
  return structuredClone(sample) as SampleData;
}

describe("readRegistry over sample data", () => {
  it("runs the real checks and agrees when every receipt matches", async () => {
    const data = clone();
    const { evm, book } = sampleReaders(data);
    const snap = await readRegistry(evm, book, OPTS);
    expect(snap.retirementsCount).toBe(data.retirements.length);
    expect(snap.pairs.map((p) => p.n)).toEqual([data.retirements.length, data.retirements.length - 1]);
    expect(snap.agreement).toEqual({ state: "agree", checked: 2, total: data.retirements.length });
    expect(snap.readAt).toBe(1234);
  });

  it("keeps the totals consistent: minted minus retired is the supply", async () => {
    const { evm, book } = sampleReaders(clone());
    const { totals } = await readRegistry(evm, book, OPTS);
    expect(totals.minted - totals.retired).toBe(totals.supply);
  });

  it("drops systems that are in config but not registered", async () => {
    const { evm, book } = sampleReaders(clone());
    const snap = await readRegistry(evm, book, OPTS);
    expect(snap.systems.map((s) => s.label)).toEqual(["A", "B"]);
  });

  it("disagrees when the newest receipt is missing or altered", async () => {
    const data = clone();
    const newest = data.retirements.at(-1)!;
    data.receipts = data.receipts.filter((r) => r.id !== newest.receiptId);
    const { evm, book } = sampleReaders(data);
    const snap = await readRegistry(evm, book, OPTS);
    expect(snap.agreement.state).toBe("disagree");
    if (snap.agreement.state === "disagree") expect(snap.agreement.failed.map((p) => p.n)).toEqual([newest.n]);
  });

  it("derives the contract's Native address from its EVM address", async () => {
    const data = clone();
    const { evm, book } = sampleReaders(data);
    const snap = await readRegistry(evm, book, OPTS);
    expect(data.receipts.every((r) => r.sender === snap.contractNative)).toBe(true);
  });

  it("fails loudly when a ledger cannot be read", async () => {
    const { evm } = sampleReaders(clone());
    const book = { receipt: async () => Promise.reject(new Error("down")) };
    await expect(readRegistry(evm, book, OPTS)).rejects.toThrow("down");
  });
});

describe("dataMode", () => {
  it("reads testnet once the contract address is configured", () => {
    expect(dataMode({ contract: "0x5e1a00000000000000000000000000000000c0de" }, undefined)).toBe("live");
  });

  it("shows sample data before deployment, or when forced for local work", () => {
    expect(dataMode({ contract: "" }, undefined)).toBe("sample");
    expect(dataMode({ contract: "0x5e1a00000000000000000000000000000000c0de" }, "sample")).toBe("sample");
  });
});
