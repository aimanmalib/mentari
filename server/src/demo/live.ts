import { addressesFrom20, fetchEvmWindow } from "@qorechain/sdk";
import { formatEther, getAddress, hexToBytes, isAddress, type Abi, type Address, type Hash, type PublicClient } from "viem";
import type { Wallet } from "../../../scripts/src/chain.js";
import { mentariDemoAbi, probeDemoAbi } from "../abi.js";
import { evmClients } from "../evm.js";
import { nativeCaller, type NativeCaller, type NativeCallResult, type NativeLaneConfig } from "../native.js";
import {
  jobOf,
  unconfiguredChain,
  type DemoAction,
  type DemoChain,
  type DemoJob,
  type DemoLane,
  type EvmWindowState,
  type SendResult,
} from "./chain.js";
import { readDemoKey } from "./keys.js";

/**
 * The live demo sender (decision 0017): the account 7 key from the read-only key folder sends each button's
 * transaction and waits for it to be mined. Each job ("Retire now", the failure buttons, the wallet grant) goes from
 * the Native lane as one hybrid-signed `MsgCrossVMCall` when its route is on (decisions 0026, 0030), and otherwise as
 * an EVM transaction sent with viem through the scoped window. The HTTP rules around it are in `api.ts`.
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

/** A job sent from the Native lane: the caller (same account as the EVM key) and the gas limit. */
export interface NativeJob {
  caller: NativeCaller;
  gas: number;
}

/** One contract call, before it is sent on either lane. */
interface Call {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
}

/** The demo over a ready chain connection. `receipts` reads the Native book's count. */
export function chainDemo(opts: {
  pub: PublicClient;
  wallet: Wallet;
  mentari: Address;
  probe: Address;
  receipts: () => Promise<number>;
  send: DemoSendConfig;
  /** The jobs sent from the Native lane. A job not listed is an EVM transaction through the window. */
  native?: Partial<Record<DemoJob, NativeJob>> | undefined;
  /** Codespace of an EVM revert inside a Native call; a failure in any other codespace is an error, not a revert. */
  revertCodespace?: string | undefined;
  /** Reads the demo account's EVM window. Without it the window counts as unreadable. */
  window?: (() => Promise<EvmWindowState>) | undefined;
}): DemoChain {
  const { pub, wallet, mentari, probe, send } = opts;
  const native = opts.native ?? {};
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
  const callFor = (action: DemoAction, retireWh: number): Call => {
    switch (action) {
      case "retire":
        return { address: mentari, abi: mentariDemoAbi, functionName: "retire", args: [BigInt(retireWh), send.retireMemo] };
      case "case-b":
        return { address: probe, abi: probeDemoAbi, functionName: "recordThenRevert", args: [send.probeNote] };
      case "case-c":
        return { address: probe, abi: probeDemoAbi, functionName: "nativeRefuses", args: [] };
      case "case-d":
        if (!send.caseDTarget) throw new Error("case D has no target yet");
        return { address: probe, abi: probeDemoAbi, functionName: "callTarget", args: [send.caseDTarget, send.probeNote] };
    }
  };
  const evmSend = async (call: Call, gas?: number): Promise<SendResult> =>
    mined(await wallet.writeContract({ ...base, ...call, ...(gas === undefined ? {} : { gas: BigInt(gas) }) } as never));
  const nativeSend = async (job: NativeJob, call: Call): Promise<SendResult> => {
    const r: NativeCallResult = await job.caller.call({ contract: call.address, abi: call.abi, functionName: call.functionName, args: call.args, gas: job.gas });
    if (r.status === "reverted" && opts.revertCodespace !== undefined && r.codespace !== opts.revertCodespace) {
      throw new Error(`${call.functionName} failed outside the EVM call (${r.codespace} code ${r.code}) in ${r.cosmosTx}`);
    }
    return { cosmosTx: r.cosmosTx, status: r.status };
  };
  const windowState = async (): Promise<EvmWindowState | null> => {
    if (!opts.window) return null;
    try {
      return await opts.window();
    } catch {
      return null;
    }
  };
  const laneOf = (job: DemoJob): DemoLane => (native[job] ? "native" : "evm-window");

  return {
    ready: () => true,
    state: async () => {
      const [balance, certificatesWh, evmWindow] = await Promise.all([pub.getBalance({ address: me }), certificates(), windowState()]);
      return {
        lanes: { retire: laneOf("retire"), cases: laneOf("cases"), grant: laneOf("grant") },
        senderBalanceQor: Number(formatEther(balance)),
        certificatesWh: Number(certificatesWh),
        evmWindow,
      };
    },
    counts: async () => {
      const [receipts, retirements] = await Promise.all([
        opts.receipts(),
        pub.readContract({ address: mentari, abi: mentariDemoAbi, functionName: "retirementsCount" }),
      ]);
      return { receipts, retirements: Number(retirements) };
    },
    send: async (action, { retireWh }) => {
      const call = callFor(action, retireWh);
      if (action === "retire") await needCertificates(retireWh);
      const job = native[jobOf(action)];
      if (job) return nativeSend(job, call);
      // The failure cases go without a gas estimate, because estimating a call that reverts fails.
      return evmSend(call, action === "retire" ? undefined : send.revertCaseGas);
    },
    isQuantumReady: (account) =>
      pub.readContract({ address: mentari, abi: mentariDemoAbi, functionName: "isQuantumReady", args: [getAddress(account)] }),
    grant: async (to, wh) => {
      await needCertificates(wh);
      const call: Call = { address: mentari, abi: mentariDemoAbi, functionName: "transfer", args: [getAddress(to), BigInt(wh)] };
      return native.grant ? nativeSend(native.grant, call) : evmSend(call);
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
  /** The Native route per job (`nativeRoute` of config/app.json). Off, or no ML-DSA-87 key, = EVM route. */
  native?: { lane: NativeLaneConfig; jobs: Record<DemoJob, { enabled: boolean; gas: number }>; revertCodespace: string } | undefined;
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
  const n = opts.native;
  const on = n ? (Object.keys(n.jobs) as DemoJob[]).filter((j) => n.jobs[j].enabled) : [];
  if (on.length > 0 && !key.pqc) log("demo sender key: no ML-DSA-87 key, so every demo job stays on the EVM route");
  const native: Partial<Record<DemoJob, NativeJob>> = {};
  if (n && key.pqc && on.length > 0) {
    const caller = nativeCaller(n.lane, { privateKey: key.privateKey, pqc: key.pqc });
    for (const j of on) native[j] = { caller, gas: n.jobs[j].gas };
  }
  const clients = evmClients(c.evmRpc, c.evmChainId, key.privateKey);
  const cosmos = addressesFrom20(hexToBytes(clients.wallet.account.address)).cosmos;
  const restFetch = (url: string) => fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(c.restTimeoutMs) });

  return chainDemo({
    ...clients,
    mentari: getAddress(c.mentari),
    probe: getAddress(c.atomicityProbe),
    receipts: restReceiptsCount({ rest: c.rest, book: c.receiptsBook, timeoutMs: c.restTimeoutMs }),
    send: c,
    native,
    revertCodespace: n?.revertCodespace,
    window: async () => {
      const w = await fetchEvmWindow({ rest: c.rest, address: cosmos, fetch: restFetch as never });
      return { live: w.live, untilBlock: w.found ? Number(w.expiryHeight) : null };
    },
  });
}
