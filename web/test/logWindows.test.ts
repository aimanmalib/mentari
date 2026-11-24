import { describe, expect, it } from "vitest";
import limits from "../../config/limits.json";
import { findInWindows, type FoundLog } from "../src/data/logWindows.js";

/** A node like the public testnet one: it refuses any range wider than `maxDistance` blocks. */
function fakeNode(logs: { block: bigint; n: number; txHash: string }[], maxDistance: bigint) {
  const calls: [bigint, bigint][] = [];
  const getLogs = async (from: bigint, to: bigint): Promise<FoundLog[]> => {
    calls.push([from, to]);
    if (to - from > maxDistance) throw new Error(`maximum [from, to] blocks distance: ${maxDistance}`);
    if (from > to) throw new Error("fromBlock after toBlock");
    return logs.filter((l) => l.block >= from && l.block <= to).map(({ n, txHash }) => ({ n, txHash }));
  };
  return { getLogs, calls };
}

const deploy = 10_606_924n;
const latest = 10_643_852n;
const logs = [
  { block: deploy + 5n, n: 1, txHash: "0x01" },
  { block: deploy + 20_000n, n: 2, txHash: "0x02" },
  { block: latest - 3n, n: 3, txHash: "0x03" },
];
const opts = { windowBlocks: limits.evm.logWindowBlocks, maxWindows: limits.evm.logMaxWindows, fromBlock: deploy };

describe("findInWindows", () => {
  it("finds a retirement older than one window without asking for a range the node refuses", async () => {
    const node = fakeNode(logs, 10_000n);
    const found = await findInWindows([1, 3], latest, node.getLogs, opts);
    expect(found).toEqual(new Map([[1, "0x01"], [3, "0x03"]]));
    expect(node.calls.every(([f, t]) => t - f < 10_000n && f >= deploy)).toBe(true);
    expect(node.calls[node.calls.length - 1]![0]).toBe(deploy);
  });

  it("stops after the newest window when everything wanted is there", async () => {
    const node = fakeNode(logs, 10_000n);
    expect(await findInWindows([3], latest, node.getLogs, opts)).toEqual(new Map([[3, "0x03"]]));
    expect(node.calls).toHaveLength(1);
    expect(node.calls[0]).toEqual([latest - 9_999n, latest]);
  });

  it("covers every block from the deploy block to the newest exactly once", async () => {
    const node = fakeNode([], 10_000n);
    await findInWindows([9], latest, node.getLogs, opts);
    const sorted = [...node.calls].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    expect(sorted[0]![0]).toBe(deploy);
    expect(sorted[sorted.length - 1]![1]).toBe(latest);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]![0]).toBe(sorted[i - 1]![1] + 1n);
  });

  it("makes at most maxWindows calls", async () => {
    const node = fakeNode([], 10_000n);
    await findInWindows([9], latest, node.getLogs, { ...opts, windowBlocks: 100, maxWindows: 3 });
    expect(node.calls).toHaveLength(3);
  });

  it("asks nothing for an empty list", async () => {
    const node = fakeNode(logs, 10_000n);
    expect((await findInWindows([], latest, node.getLogs, opts)).size).toBe(0);
    expect(node.calls).toHaveLength(0);
  });
});

describe("config/limits.json evm", () => {
  it("keeps each request inside the public node's 10000-block distance", () => {
    expect(limits.evm.logWindowBlocks).toBeGreaterThan(0);
    expect(limits.evm.logWindowBlocks - 1).toBeLessThanOrEqual(10_000);
    expect(limits.evm.logMaxWindows).toBeGreaterThan(0);
  });
});
