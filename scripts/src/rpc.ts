import { createPublicClient, createWalletClient, defineChain, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Wallet } from "./chain.js";

function lane(evmRpc: string, evmChainId: number) {
  const chain = defineChain({
    id: evmChainId,
    name: "qorechain",
    nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
    rpcUrls: { default: { http: [evmRpc] } },
  });
  return { chain, transport: http(evmRpc) };
}

/** A reader on the EVM lane (`network.evmRpc`, `network.evmChainId`). Needs no key. */
export function publicClient(evmRpc: string, evmChainId: number): PublicClient {
  return createPublicClient(lane(evmRpc, evmChainId)) as PublicClient;
}

/** A reader and a signing wallet for one key on the EVM lane. */
export function evmClients(evmRpc: string, evmChainId: number, key: Hex): { pub: PublicClient; wallet: Wallet } {
  const { chain, transport } = lane(evmRpc, evmChainId);
  return {
    pub: createPublicClient({ chain, transport }) as PublicClient,
    wallet: createWalletClient({ chain, transport, account: privateKeyToAccount(key) }) as Wallet,
  };
}
