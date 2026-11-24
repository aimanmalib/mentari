import type { StepRecord } from "./native-entry.js";

/**
 * Case I: what a stolen classical key can do. `Mentari.retire` and `transfer` act for `msg.sender`, so whoever can
 * send an EVM transaction from an account can spend its certificates. On this chain an EVM transaction is admitted
 * only through an EVM window the account opened with a hybrid (secp256k1 + ML-DSA-87) signature. Step 1 sends
 * `retire` as a plain EVM transaction signed with the secp256k1 key alone, from an account with no window, and
 * records what the chain answers. Step 2 sends the same `retire` from the same account as a hybrid-signed
 * `MsgCrossVMCall`, the way the site does. Nothing retries or works around a refusal.
 */

/** The `classicOnly` block of config/app.json. */
export interface ClassicOnlyConfig {
  /** The role that sends both steps. Its EVM window must be closed. */
  role: string;
  retireWh: number;
  memo: string;
  /** Gas limit of the step 1 EVM transaction. Fixed, so no estimate runs before the send. */
  evmGas: number;
  /** Gas limit of the step 2 `MsgCrossVMCall`. */
  nativeGas: number;
  /** Certificates the demo sender gives the role, from the Native lane, when it holds fewer than `retireWh`. */
  stockWh: number;
  /** How long to look for a receipt of the step 1 transaction after the node answered. */
  waitSeconds: number;
}

/** Contract readings before and after step 1. */
export interface Holdings {
  nonce: number;
  certificates: string;
  retirementsCount: string;
}

/** Step 1 of case I as `evidence/testnet.json` records it. */
export interface ClassicRecord {
  question: string;
  function: "retire";
  args: string[];
  signed_with: "secp256k1 only";
  window_before: "closed";
  /** Keccak hash of the signed transaction, computed before sending. */
  evm_tx: string;
  /** What an `eth_call` of the same call from the same address says: the contract itself would accept it. */
  eth_call: string;
  /** The node's answer to `eth_sendRawTransaction`: an error message, or null when it took the transaction. */
  rpc_error: string | null;
  /** Whether a receipt for `evm_tx` appeared within `waitSeconds`. */
  receipt_found: boolean;
  receipt_status: "success" | "reverted" | null;
  /** True when the transaction never ran: no receipt, nonce and holdings unchanged. */
  refused: boolean;
  before: Holdings;
  after: Holdings;
}

export interface ClassicEnv {
  windowLive(): Promise<boolean>;
  holdings(): Promise<Holdings>;
  /** Simulate the call from the sender's address; resolves to the outcome in words. */
  ethCall(): Promise<string>;
  /** Sign the EVM transaction with the secp256k1 key at `nonce`. Returns the raw bytes and their hash. */
  signClassic(nonce: number): Promise<{ raw: `0x${string}`; hash: `0x${string}` }>;
  /** `eth_sendRawTransaction`. Throws with the node's message when it refuses. */
  sendRaw(raw: `0x${string}`): Promise<string>;
  /** The receipt status, or null when the node has none. */
  receipt(hash: `0x${string}`): Promise<"success" | "reverted" | null>;
  /** Wait `ms`; tests pass a no-op. */
  sleep(ms: number): Promise<void>;
  pollMs: number;
}

const MESSAGE_MAX = 400;

/** First line of an error, without viem's request dump. */
export function nodeMessage(err: unknown): string {
  const e = err as { details?: unknown; shortMessage?: unknown; message?: unknown };
  const text = [e.details, e.shortMessage, e.message].find((v) => typeof v === "string" && v.length > 0) as string | undefined;
  const line = (text ?? String(err)).split("\n")[0]!.trim();
  return line.length > MESSAGE_MAX ? `${line.slice(0, MESSAGE_MAX)}…` : line;
}

export const CLASSIC_QUESTION =
  "Can an account's secp256k1 key alone retire its certificates? An EVM transaction calling Mentari.retire, signed without ML-DSA-87, with no EVM window open.";

/** Send step 1 and record the chain's answer. Refuses to send while the sender has a live EVM window. */
export async function classicAttempt(env: ClassicEnv, cfg: Pick<ClassicOnlyConfig, "retireWh" | "memo" | "waitSeconds">): Promise<ClassicRecord> {
  if (await env.windowLive()) throw new Error("the sender has a live EVM window; case I needs it closed");
  const before = await env.holdings();
  const ethCall = await env.ethCall();
  const { raw, hash } = await env.signClassic(before.nonce);
  let rpcError: string | null = null;
  try {
    await env.sendRaw(raw);
  } catch (err) {
    rpcError = nodeMessage(err);
  }
  let status: "success" | "reverted" | null = null;
  const tries = Math.max(1, Math.ceil((cfg.waitSeconds * 1000) / env.pollMs));
  for (let i = 0; i < tries; i++) {
    status = await env.receipt(hash);
    // A refused send gets one look: a node that refuses can still have gossiped it.
    if (status !== null || rpcError !== null) break;
    await env.sleep(env.pollMs);
  }
  const after = await env.holdings();
  const unchanged =
    after.nonce === before.nonce && after.certificates === before.certificates && after.retirementsCount === before.retirementsCount;
  return {
    question: CLASSIC_QUESTION,
    function: "retire",
    args: [String(cfg.retireWh), cfg.memo],
    signed_with: "secp256k1 only",
    window_before: "closed",
    evm_tx: hash,
    eth_call: ethCall,
    rpc_error: rpcError,
    receipt_found: status !== null,
    receipt_status: status,
    refused: status === null && unchanged,
    before,
    after,
  };
}

/** Case I in `evidence/testnet.json` `cases`. `steps` holds step 2, the Native retire, in the case H step format. */
export interface ClassicOnlyEntry {
  id: "I";
  title: string;
  sender: { role: string; cosmos: string; evm: string };
  ranAt: string;
  classic: ClassicRecord;
  steps: StepRecord[];
}
