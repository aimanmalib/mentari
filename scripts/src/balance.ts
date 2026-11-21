import { formatUnits } from "viem";

/** EVM balance of an address via a public JSON-RPC endpoint (no key needed). */
export async function evmBalance(rpcUrl: string, address: string, fetchFn: typeof fetch = fetch): Promise<bigint> {
  const res = await fetchFn(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
  });
  if (!res.ok) throw new Error(`eth_getBalance: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (typeof body.result !== "string") throw new Error(`eth_getBalance: ${body.error?.message ?? "no result"}`);
  return BigInt(body.result);
}

export function formatAmount(wei: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(wei, decimals)} ${symbol}`;
}
