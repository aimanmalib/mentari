import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { qorechainTestnet, qorexWallet } from "@qorechain/qorex-rainbowkit";
import { defineChain } from "viem";
import { createConfig, http, type Config } from "wagmi";
import type { SiteConfig } from "../config.js";

/**
 * wagmi for the wallet path: the QoreChain testnet from the QoreX kit, with the RPC and chain id from config/app.json,
 * and QoreX as the only wallet. QoreX does not emit account or network events yet, so the connector re-reads both
 * when the page regains focus.
 */
export function walletConfig(cfg: Pick<SiteConfig, "evmRpc" | "evmChainId">, groupName: string): Config {
  const { name, nativeCurrency, blockExplorers } = qorechainTestnet;
  const chain = defineChain({ id: cfg.evmChainId, name, nativeCurrency, blockExplorers, rpcUrls: { default: { http: [cfg.evmRpc] } }, testnet: true });
  const connectors = connectorsForWallets([{ groupName, wallets: [() => qorexWallet({ pollAccountsOnFocus: true })] }], {
    appName: "Mentari",
    // RainbowKit asks every app for a WalletConnect project id; QoreX connects in the page and never uses it.
    projectId: "unused",
  });
  // Other injected wallets are not offered: the page is about QoreX and its ML-DSA-87 accounts.
  return createConfig({ chains: [chain], connectors, multiInjectedProviderDiscovery: false, transports: { [chain.id]: http(cfg.evmRpc) } });
}
