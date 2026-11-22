import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { mentariReadAbi } from "./abi.js";
import type { MentariReader } from "./registry.js";

/** Live reader for the Mentari contract over the public EVM JSON-RPC endpoint. */
export function mentariReader(rpcUrl: string, contract: string): MentariReader {
  const client: PublicClient = createPublicClient({
    transport: http(rpcUrl, { batch: true, retryCount: 1, timeout: 10_000 }),
  });
  const address = contract as Address;
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address, abi: mentariReadAbi, functionName, args } as never) as Promise<T>;
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
