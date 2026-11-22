import { createPublicClient, createWalletClient, defineChain, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Wallet } from "../../scripts/src/chain.js";

/** A reader and a signing wallet for one key on the EVM lane (`network.evmRpc`, `network.evmChainId`). */
export function evmClients(evmRpc: string, evmChainId: number, key: Hex): { pub: PublicClient; wallet: Wallet } {
  const chain = defineChain({
    id: evmChainId,
    name: "qorechain",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
    rpcUrls: { default: { http: [evmRpc] } },
  });
  const transport = http(evmRpc);
  return {
    pub: createPublicClient({ chain, transport }) as PublicClient,
    wallet: createWalletClient({ chain, transport, account: privateKeyToAccount(key) }) as Wallet,
  };
}
