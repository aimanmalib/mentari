import { getQorexNative, hasCapability, qorexSignAndBroadcast } from "@qorechain/qorex-types";
import { useEffect, useState } from "react";
import { parseEventLogs, type Address, type Hash } from "viem";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { siteConfig } from "../config.js";
import { evmToNative, nativeToEvm } from "../data/address.js";
import { mentariReadAbi, mentariWalletAbi, retiredEvent } from "../data/abi.js";
import { requestGrant, type GrantRefusal } from "../data/grant.js";
import { classifyWalletError, type WalletProblem } from "./errors.js";
import { retireCall, selfSend, type EncodedMessage } from "./nativeMsgs.js";

export type WalletLane = "native" | "evm";

export type WalletResult =
  | { kind: "granted"; hash: string; wh: number }
  | { kind: "grant-refused"; reason: GrantRefusal; retryAfterSeconds?: number }
  | { kind: "key-registered"; hash: string }
  | { kind: "retired"; lane: WalletLane; hash: string; n: number | null; shielded: boolean }
  | { kind: "problem"; problem: WalletProblem; hash?: string };

const browserFetch = (url: string, init?: RequestInit) => fetch(url, init);

/** QoreX's Native provider, when this build can sign and send a Native transaction for the page. */
function nativeSender() {
  const native = getQorexNative();
  return native && hasCapability(native, "signAndBroadcast") ? native : null;
}

/** A Cosmos transaction hash as the explorer wants it: upper-case hex, no `0x`. */
const cosmosHash = (hash: string) => hash.replace(/^0x/i, "").toUpperCase();

/** One Native transaction through QoreX, which adds the hybrid secp256k1 + ML-DSA-87 signature and broadcasts. */
async function sendNative(message: EncodedMessage, gasLimit?: number) {
  const native = nativeSender();
  // Without a capable provider the kit throws QOREX_NOT_INSTALLED or QOREX_NOT_SUPPORTED_YET, which the page explains.
  const out = await qorexSignAndBroadcast(
    { chainId: siteConfig.chainId, messages: [message], ...(gasLimit ? { gasLimit } : {}) },
    native ? { native } : {},
  );
  return { hash: cosmosHash(out.txHash), ok: out.code === 0, shielded: out.shield === "shielded" };
}

/** What the connected wallet holds and may do, and the actions: register a key, ask for certificates, retire them. */
export function useWalletActions() {
  const { address: evmAddress } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const contract = (siteConfig.contract || null) as Address | null;
  const [busy, setBusy] = useState<"key" | "grant" | "retire" | null>(null);
  const [result, setResult] = useState<WalletResult | null>(null);
  // Read on every render: QoreX may inject its provider after the page has loaded.
  const lane: WalletLane = nativeSender() ? "native" : "evm";
  // QoreX derives its Native and EVM accounts separately. On the Native lane the account is the Native one: it signs,
  // and the contract sees it at the EVM form of the same bytes. So certificates go to, and are read from, that form.
  const [nativeKey, setNativeKey] = useState<string | null>(null);
  useEffect(() => {
    const native = nativeSender();
    if (lane !== "native" || !evmAddress || !native) return setNativeKey(null);
    let live = true;
    native.getKey(siteConfig.chainId).then(
      (k) => live && setNativeKey(k.bech32Address),
      () => live && setNativeKey(null),
    );
    return () => {
      live = false;
    };
  }, [lane, evmAddress]);
  const address: Address | undefined = lane === "native" ? (nativeKey ? nativeToEvm(nativeKey) : undefined) : evmAddress;
  const nativeAddress = lane === "native" ? nativeKey : evmAddress ? evmToNative(evmAddress, siteConfig.nativePrefix) : null;

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

  const run = async (kind: "key" | "grant" | "retire", work: () => Promise<WalletResult>) => {
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

  // QoreX registers the account's ML-DSA-87 key before the first transaction it sends; a 1 uqor send to itself is enough.
  const registerKey = () =>
    run("key", async () => {
      const out = await sendNative(selfSend(nativeAddress!, "uqor", siteConfig.wallet.keySetupUqor));
      return out.ok ? { kind: "key-registered", hash: out.hash } : { kind: "problem", problem: "failed", hash: out.hash };
    });

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
      const wh = BigInt(siteConfig.demoRetireWh);
      const memo = siteConfig.wallet.memo;
      // Simulate first: a contract error (no certificates, wrong account) is explained before the wallet is asked.
      const { request, result: simulated } = await client!.simulateContract({
        account: address!,
        address: contract!,
        abi: mentariWalletAbi,
        functionName: "retire",
        args: [wh, memo],
      });
      if (lane === "native") {
        const out = await sendNative(retireCall(nativeAddress!, contract!, wh, memo), siteConfig.nativeRetireGas);
        if (!out.ok) return { kind: "problem", problem: "failed", hash: out.hash };
        return { kind: "retired", lane, hash: out.hash, n: await confirmed(simulated[0]), shielded: out.shielded };
      }
      const hash = await writeContractAsync(request);
      const receipt = await client!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") return { kind: "problem", problem: "failed", hash };
      const [log] = parseEventLogs({ abi: [retiredEvent], logs: receipt.logs });
      return { kind: "retired", lane, hash, n: log ? Number(log.args.n) : null, shielded: false };
    });

  /** The retirement number the simulation predicted, if the chain now holds this account's retirement there. */
  const confirmed = async (n: bigint): Promise<number | null> => {
    try {
      const r = await client!.readContract({ address: contract!, abi: mentariReadAbi, functionName: "retirement", args: [n] });
      return r.holder.toLowerCase() === address!.toLowerCase() ? Number(n) : null;
    } catch {
      return null;
    }
  };

  return { address, nativeAddress, contract, balance, ready, lane, reading: reads.isLoading, busy, result, registerKey, grant, retire };
}
