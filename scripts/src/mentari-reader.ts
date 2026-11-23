import { getAddress, parseAbi, TransactionReceiptNotFoundError, type Address, type Hex, type PublicClient } from "viem";
import type { EvmReader } from "./verify.js";

/** The read-only part of the Mentari ABI that `verify` needs, so it runs without a contract build. */
export const MENTARI_READ_ABI = parseAbi([
  "function receiptsBook() view returns (string)",
  "function retirementsCount() view returns (uint256)",
  "function retirement(uint256 n) view returns ((address holder, uint64 wh, uint64 receiptId, uint64 timestamp))",
  "function totals() view returns (uint256 minted_, uint256 retired_, uint256 supply)",
]);

/** An `EvmReader` over a public client and the deployed Mentari contract. */
export function mentariReader(pub: PublicClient, mentari: string): EvmReader {
  const address = getAddress(mentari);
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ address, abi: MENTARI_READ_ABI, functionName, args } as never) as Promise<T>;
  return {
    async hasCode(a) {
      const code = await pub.getCode({ address: getAddress(a) as Address });
      return code !== undefined && code !== "0x";
    },
    receiptsBook: () => read<string>("receiptsBook"),
    retirementsCount: () => read<bigint>("retirementsCount"),
    async retirement(n) {
      const r = await read<{ holder: string; wh: bigint; receiptId: bigint }>("retirement", [n]);
      return { holder: r.holder, wh: r.wh, receiptId: r.receiptId };
    },
    async totals() {
      const [minted, retired, supply] = await read<readonly [bigint, bigint, bigint]>("totals");
      return { minted, retired, supply };
    },
    async tx(hash) {
      try {
        const r = await pub.getTransactionReceipt({ hash: hash as Hex });
        return { status: r.status, to: r.to };
      } catch (err) {
        if (err instanceof TransactionReceiptNotFoundError) return null;
        throw err;
      }
    },
  };
}
