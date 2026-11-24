import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, numberToHex } from "viem";
import { retiredEvent } from "../src/data/abi.js";
import { mentariReader } from "../src/data/evm.js";

const contract = "0xf5cb2c6048a7ce8c5a7accc66eb8efc33942a448";
const holder = "0x9dEF414277275054bF585EAE1Cc6A4b2b673078B";
const deployBlock = 10_606_924;
const latest = 10_643_852n;
const retired = [
  { block: BigInt(deployBlock) + 5n, n: 1n, tx: `0x${"a1".repeat(32)}` },
  { block: latest - 2n, n: 2n, tx: `0x${"b2".repeat(32)}` },
];

function log(r: (typeof retired)[number]) {
  return {
    address: contract,
    topics: encodeEventTopics({ abi: [retiredEvent], eventName: "Retired", args: { n: r.n, holder, receiptId: 7n } }),
    data: encodeAbiParameters([{ type: "uint256" }, { type: "string" }], [500n, "memo"]),
    blockNumber: numberToHex(r.block),
    blockHash: `0x${"00".repeat(32)}`,
    transactionHash: r.tx,
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
  };
}

/** JSON-RPC like the public testnet node: `eth_getLogs` over more than 10000 blocks is an error. */
function answer(req: { id: number; method: string; params: { fromBlock: string; toBlock: string }[] }) {
  if (req.method === "eth_blockNumber") return { jsonrpc: "2.0", id: req.id, result: numberToHex(latest) };
  if (req.method !== "eth_getLogs") return { jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "no" } };
  const p = req.params[0]!;
  const to = p.toBlock === "latest" ? latest : BigInt(p.toBlock);
  const from = BigInt(p.fromBlock);
  if (to - from > 10_000n) return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "maximum [from, to] blocks distance: 10000" } };
  return { jsonrpc: "2.0", id: req.id, result: retired.filter((r) => r.block >= from && r.block <= to).map(log) };
}

afterEach(() => vi.unstubAllGlobals());

describe("mentariReader.retiredTxs on a node that limits log ranges", () => {
  it("finds the transaction of the first and the newest retirement", async () => {
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const out = Array.isArray(body) ? body.map(answer) : answer(body);
      return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
    });
    const reader = mentariReader("http://node.test", contract, { deployBlock, windowBlocks: 10_000, maxWindows: 60 });
    const txs = await reader.retiredTxs([1, 2]);
    expect(txs.get(1)).toBe(retired[0]!.tx);
    expect(txs.get(2)).toBe(retired[1]!.tx);
  });
});
