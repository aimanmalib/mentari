import { formatEther, getAddress, isAddress, type Address, type Hash, type PublicClient } from "viem";
import type { Wallet } from "../../../scripts/src/chain.js";
import { mentariDemoAbi, probeDemoAbi } from "../abi.js";
import { evmClients } from "../evm.js";
import { unconfiguredChain, type DemoAction, type DemoChain, type SendResult } from "./chain.js";
import { readDemoKey } from "./keys.js";

/**
 * The live demo sender (decision 0017): the account 7 key from the read-only key folder sends each button's
 * transaction with viem and waits for it to be mined. The HTTP rules around it (limits, deadline, fallback) are
 * in `api.ts` and do not change.
 */

/** What the buttons send (`demo` block of `config/limits.json`, `native.notAllowlistedTarget` of `config/app.json`). */
export interface DemoSendConfig {
  /** Memo of each "Retire now" retirement; it is written to the public Native receipt. */
  retireMemo: string;
  /** Note the probe cases B and D try to record. */
  probeNote: string;
  /** Gas limit for cases B, C and D. They are sent without an estimate, because estimating a call that reverts fails. */
  revertCaseGas: number;
  /** A Native contract that is not on the bridge allowlist (case D). Empty until one is measured on the testnet. */
  caseDTarget: string;
}

/** Where everything lives, from `config/app.json`. Contract addresses are empty until deployed. */
export interface DemoChainConfig extends DemoSendConfig {
  evmRpc: string;
  evmChainId: number;
  /** Native REST origin, for the receipts count. */
  rest: string;
  receiptsBook: string;
  mentari: string;
  atomicityProbe: string;
  /** Longest wait for one REST read. */
  restTimeoutMs: number;
}

type FetchFn = (url: string, init: { signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Total receipts in the Native book, from the `count` query over public REST. */
export function restReceiptsCount(opts: { rest: string; book: string; timeoutMs: number; fetch?: FetchFn }) {
  const query = Buffer.from(JSON.stringify({ count: {} })).toString("base64");
  const url = `${opts.rest.replace(/\/+$/, "")}/cosmwasm/wasm/v1/contract/${opts.book}/smart/${encodeURIComponent(query)}`;
  const f: FetchFn = opts.fetch ?? fetch;
  return async (): Promise<number> => {
    const res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs) });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Not JSON: reported below by status.
    }
    const count = (body as { data?: { count?: unknown } } | null)?.data?.count;
    if (res.status !== 200 || typeof count !== "number") throw new Error(`receipts count unreadable (HTTP ${res.status})`);
    return count;
  };
}

/** The demo over a ready chain connection. `receipts` reads the Native book's count. */
export function chainDemo(opts: {
  pub: PublicClient;
  wallet: Wallet;
  mentari: Address;
  probe: Address;
  receipts: () => Promise<number>;
  send: DemoSendConfig;
}): DemoChain {
  const { pub, wallet, mentari, probe, send } = opts;
  const me = wallet.account.address;
  const base = { account: wallet.account, chain: wallet.chain };
  const mined = async (hash: Hash): Promise<SendResult> => {
    const r = await pub.waitForTransactionReceipt({ hash });
    return { evmTx: hash, status: r.status };
  };
  const certificates = () => pub.readContract({ address: mentari, abi: mentariDemoAbi, functionName: "balanceOf", args: [me] });
  const needCertificates = async (wh: number) => {
    const have = await certificates();
    if (have < BigInt(wh)) throw new Error(`the demo account holds ${have} Wh of certificates, needs ${wh}`);
  };
  const revertCase = { ...base, address: probe, abi: probeDemoAbi, gas: BigInt(send.revertCaseGas) } as const;

  const sendAction = async (action: DemoAction, retireWh: number): Promise<Hash> => {
    switch (action) {
      case "retire":
        await needCertificates(retireWh);
        return wallet.writeContract({
          ...base,
          address: mentari,
          abi: mentariDemoAbi,
          functionName: "retire",
          args: [BigInt(retireWh), send.retireMemo],
        });
      case "case-b":
        return wallet.writeContract({ ...revertCase, functionName: "recordThenRevert", args: [send.probeNote] });
      case "case-c":
        return wallet.writeContract({ ...revertCase, functionName: "nativeRefuses" });
      case "case-d":
        if (!send.caseDTarget) throw new Error("case D has no target yet");
        return wallet.writeContract({ ...revertCase, functionName: "callTarget", args: [send.caseDTarget, send.probeNote] });
    }
  };

  return {
    ready: () => true,
    senderBalanceQor: async () => Number(formatEther(await pub.getBalance({ address: me }))),
    counts: async () => {
      const [receipts, retirements] = await Promise.all([
        opts.receipts(),
        pub.readContract({ address: mentari, abi: mentariDemoAbi, functionName: "retirementsCount" }),
      ]);
      return { receipts, retirements: Number(retirements) };
    },
    send: async (action, { retireWh }) => mined(await sendAction(action, retireWh)),
    isQuantumReady: (account) =>
      pub.readContract({ address: mentari, abi: mentariDemoAbi, functionName: "isQuantumReady", args: [getAddress(account)] }),
    grant: async (to, wh) => {
      await needCertificates(wh);
      const hash = await wallet.writeContract({
        ...base,
        address: mentari,
        abi: mentariDemoAbi,
        functionName: "transfer",
        args: [getAddress(to), BigInt(wh)],
      });
      return mined(hash);
    },
  };
}

/**
 * The demo the server runs. It stays on `unconfiguredChain` (every button shows the recorded case) until both
 * contract addresses are set and the key file exists. A key file that is there but wrong is logged once, without
 * its contents, and also leaves the demo on the recorded cases.
 */
export function liveDemoChain(opts: {
  chain: DemoChainConfig;
  keysDir: string | undefined;
  log?: ((line: string) => void) | undefined;
}): DemoChain {
  const log = opts.log ?? ((line: string) => console.log(line));
  const c = opts.chain;
  if (!isAddress(c.mentari) || !isAddress(c.atomicityProbe)) return unconfiguredChain;
  let key;
  try {
    key = readDemoKey(opts.keysDir);
  } catch (err) {
    log(`demo sender key: ${(err as Error).message}`);
    return unconfiguredChain;
  }
  if (!key) return unconfiguredChain;

  return chainDemo({
    ...evmClients(c.evmRpc, c.evmChainId, key),
    mentari: getAddress(c.mentari),
    probe: getAddress(c.atomicityProbe),
    receipts: restReceiptsCount({ rest: c.rest, book: c.receiptsBook, timeoutMs: c.restTimeoutMs }),
    send: c,
  });
}
