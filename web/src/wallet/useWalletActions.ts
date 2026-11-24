import { useState } from "react";
import { parseEventLogs, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { siteConfig } from "../config.js";
import { mentariWalletAbi, retiredEvent } from "../data/abi.js";
import { requestGrant, type GrantRefusal } from "../data/grant.js";
import { classifyWalletError, type WalletProblem } from "./errors.js";

export type WalletResult =
  | { kind: "granted"; hash: string; wh: number }
  | { kind: "grant-refused"; reason: GrantRefusal; retryAfterSeconds?: number }
  | { kind: "retired"; hash: Hash; n: number | null }
  | { kind: "problem"; problem: WalletProblem; hash?: Hash };

const browserFetch = (url: string, init?: RequestInit) => fetch(url, init);

/** What the connected wallet holds and may do, and the two actions: ask for certificates, retire them. */
export function useWalletActions() {
  const { address } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const contract = (siteConfig.contract || null) as Address | null;
  const [busy, setBusy] = useState<"grant" | "retire" | null>(null);
  const [result, setResult] = useState<WalletResult | null>(null);

  const reads = useReadContracts({
    contracts:
      address && contract
        ? [
            { address: contract, abi: mentariWalletAbi, functionName: "balanceOf", args: [address] },
            { address: contract, abi: mentariWalletAbi, functionName: "isQuantumReady", args: [address] },
          ]
        : [],
    query: { enabled: Boolean(address && contract) },
  });
  const [balanceRead, readyRead] = reads.data ?? [];
  const balance = balanceRead?.status === "success" ? (balanceRead.result as bigint) : null;
  const ready = readyRead?.status === "success" ? (readyRead.result as boolean) : null;

  const run = async (kind: "grant" | "retire", work: () => Promise<WalletResult>) => {
    if (busy || !address || !contract || !client) return;
    setBusy(kind);
    setResult(null);
    try {
      setResult(await work());
    } catch (err) {
      setResult({ kind: "problem", problem: classifyWalletError(err) });
    } finally {
      setBusy(null);
      void reads.refetch();
    }
  };

  const grant = () =>
    run("grant", async () => {
      const out = await requestGrant(browserFetch, siteConfig.demoApi, address!);
      if (out.kind === "refused") return { ...out, kind: "grant-refused" };
      // A Native grant is already in a block when the server answers; an EVM one is waited for here.
      if (out.lane === "evm") await client!.waitForTransactionReceipt({ hash: out.hash as Hash });
      return { kind: "granted", hash: out.hash, wh: out.wh };
    });

  const retire = () =>
    run("retire", async () => {
      // Simulate first: a contract error (no certificates, wrong account) is explained before the wallet is asked.
      const { request } = await client!.simulateContract({
        account: address!,
        address: contract!,
        abi: mentariWalletAbi,
        functionName: "retire",
        args: [BigInt(siteConfig.demoRetireWh), siteConfig.wallet.memo],
      });
      const hash = await writeContractAsync(request);
      const receipt = await client!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return { kind: "problem", problem: "failed", hash };
      const [log] = parseEventLogs({ abi: [retiredEvent], logs: receipt.logs });
      return { kind: "retired", hash, n: log ? Number(log.args.n) : null };
    });

  return { contract, balance, ready, reading: reads.isLoading, busy, result, grant, retire };
}
