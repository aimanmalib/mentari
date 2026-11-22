import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { mentariReadAbi, retiredEvent } from "./abi.js";
import type { MentariReader } from "./registry.js";

/** Live reader for the Mentari contract over the public EVM JSON-RPC endpoint. */
function client(rpcUrl: string): PublicClient {
  return createPublicClient({ transport: http(rpcUrl, { batch: true, retryCount: 1, timeout: 10_000 }) });
}

/** Status of a mined EVM transaction, or null when the node does not know it. */
export function txStatusReader(rpcUrl: string): (hash: string) => Promise<"success" | "reverted" | null> {
  const c = client(rpcUrl);
  return async (hash) => {
    try {
      return (await c.getTransactionReceipt({ hash: hash as `0x${string}` })).status;
    } catch (err) {
      if (err instanceof Error && err.name === "TransactionReceiptNotFoundError") return null;
      throw err;
    }
  };
}

export function mentariReader(rpcUrl: string, contract: string, deployBlock = 0): MentariReader {
  const c = client(rpcUrl);
  const address = contract as Address;
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    c.readContract({ address, abi: mentariReadAbi, functionName, args } as never) as Promise<T>;
  return {
    async totals() {
      const [minted, retired, supply] = await read<readonly [bigint, bigint, bigint]>("totals");
      return { minted, retired, supply };
    },
    async retirementsCount() {
      return Number(await read<bigint>("retirementsCount"));
    },
    async retirement(n) {
      const r = await read<{ holder: string; wh: bigint; receiptId: bigint; timestamp: bigint }>("retirement", [BigInt(n)]);
      return { n, holder: r.holder, wh: r.wh, receiptId: Number(r.receiptId), timestamp: Number(r.timestamp) };
    },
    async retiredTxs(ns) {
      const out = new Map<number, string>();
      if (ns.length === 0) return out;
      const logs = await c.getLogs({
        address,
        event: retiredEvent,
        args: { n: ns.map(BigInt) },
        fromBlock: BigInt(deployBlock),
        toBlock: "latest",
      });
      for (const log of logs) if (log.args.n !== undefined && log.transactionHash) out.set(Number(log.args.n), log.transactionHash);
      return out;
    },
    async system(id, label) {
      try {
        const s = await read<{ meter: string; producer: string; capacityW: number; firstDay: number }>("system", [id]);
        const maxWh = await read<bigint>("maxWh", [s.capacityW]);
        return { id, label, meter: s.meter, producer: s.producer, capacityW: s.capacityW, firstDay: s.firstDay, maxWh };
      } catch (err) {
        // `UnknownSystem(id)`: the system is in config but not registered on chain yet.
        if (err instanceof Error && /UnknownSystem/.test(err.message)) return null;
        throw err;
      }
    },
  };
}
