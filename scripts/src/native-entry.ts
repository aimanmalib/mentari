import { crossvm } from "@qorechain/sdk";
import { encodeFunctionData, type Abi, type Address } from "viem";
import type { Submitted, Submitter } from "./lane.js";
import { feeForGas, type Actor, type EncodeObject, type NativeSettings } from "./native.js";

/**
 * Case H, experiment E1: call Mentari from the Native lane. An account with no EVM window open signs a hybrid
 * (secp256k1 + ML-DSA-87) `MsgCrossVMCall` whose target is the Mentari contract. Step 1 carries `attest`, a plain EVM
 * call; step 2 carries `retire`, which itself calls the bridge at 0x…0901 back into the Native receipts book. Each
 * step records what the chain answered, accepted or not, and the contract state it should have changed, before and
 * after. Nothing here retries or works around a refusal: the refusal is the finding.
 */

export const CROSS_VM_CALL_TYPE_URL = "/qorechain.crossvm.v1.MsgCrossVMCall";

/** The `nativeEntry` block of config/app.json. */
export interface NativeEntryConfig {
  /** The role that sends both steps. Its EVM window must be closed. */
  role: string;
  /** The system whose meter signs the step 1 reading. */
  system: number;
  retireWh: number;
  memo: string;
  /** Gas limit of each `MsgCrossVMCall`. Simulating would hide a refusal behind an estimate error. */
  gas: number;
  /** Certificates given to the sender before step 2 when it holds fewer than `retireWh`. */
  stockWh: number;
}

/** A hybrid-signed call into an EVM contract, sent from the Native lane. `sourceVm` is ignored by the chain. */
export function crossVmCallMsg(sender: string, contract: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  return crossvm.crossVmCall({
    sender,
    sourceVm: "cosmwasm",
    targetVm: "evm",
    targetContract: contract,
    payload: Buffer.from(data.slice(2), "hex"),
  }) as EncodeObject;
}

export interface StepSpec {
  step: 1 | 2;
  question: string;
  functionName: "attest" | "retire";
  args: readonly unknown[];
  /** What the contract does with these arguments once the call reaches it. */
  contractWould: string;
}

/** One step of case H as `evidence/testnet.json` records it. */
export interface StepRecord {
  step: 1 | 2;
  question: string;
  function: string;
  args: string[];
  contract_would: string;
  window_before: "closed";
  cosmos_tx: string;
  /** `check`: refused by the node before any block. `block`: included; `code` 0 = it ran. */
  stage: Submitted["stage"];
  code: number;
  codespace: string;
  log: string;
  height: number | null;
  gas_used: number | null;
  accepted: boolean;
  /** For a call that did not go through: the reason an `eth_call` of the same call from the sender gives. */
  revert_reason: string | null;
  event_types: string[];
  /** Receipts book count at the block before and at the transaction's block (null when it was not in a block). */
  receipts: { before: number; after: number } | null;
  state: { name: string; before: string; after: string }[];
}

export interface StepEnv {
  actor: Pick<Actor, "role" | "cosmos" | "sign">;
  submitter: Submitter;
  account(address: string): Promise<{ accountNumber: bigint; sequence: bigint } | undefined>;
  /** Whether the sender's EVM window is live. */
  windowLive(): Promise<boolean>;
  mentari: { address: Address; abi: Abi };
  /** Named contract readings (`attested(3, 20780)`, `retirementsCount`, …) the step should change. */
  probe(spec: StepSpec): Promise<Record<string, string>>;
  /** Receipts book count at the end of block `height`. */
  receiptsAt(height: number): Promise<number>;
  /** Why the same call, made as an `eth_call` from the sender's EVM address, fails. */
  revertReason(spec: StepSpec): Promise<string>;
  lane: Pick<NativeSettings["nativeLane"], "denom" | "gasPriceUqor">;
  gas: number;
  /** Messages signed into the same transaction ahead of the call (cases J and J2: the fee transfer). */
  leading?: EncodeObject[];
}

const LOG_MAX = 600;

/** Send one step and record the chain's answer. Refuses to send while the sender has a live EVM window. */
export async function runStep(env: StepEnv, spec: StepSpec): Promise<StepRecord> {
  if (await env.windowLive()) throw new Error(`${env.actor.role} has a live EVM window; E1 needs it closed`);
  const acct = await env.account(env.actor.cosmos);
  if (!acct) throw new Error(`${env.actor.role} ${env.actor.cosmos} has no funds`);
  const before = await env.probe(spec);
  const msg = crossVmCallMsg(env.actor.cosmos, env.mentari.address, env.mentari.abi, spec.functionName, spec.args);
  const fee = feeForGas(env.lane, BigInt(env.gas));
  const bytes = env.actor.sign({ messages: [...(env.leading ?? []), msg], fee, ...acct, classical: false });
  const r = await env.submitter.submit(bytes);
  const after = await env.probe(spec);
  const accepted = r.stage === "block" && r.code === 0;
  const h = r.height;
  return {
    step: spec.step,
    question: spec.question,
    function: spec.functionName,
    args: spec.args.map(showArg),
    contract_would: spec.contractWould,
    window_before: "closed",
    cosmos_tx: r.hash,
    stage: r.stage,
    code: r.code,
    codespace: r.codespace,
    log: r.log.length > LOG_MAX ? `${r.log.slice(0, LOG_MAX)}…` : r.log,
    height: r.height,
    gas_used: r.gasUsed,
    accepted,
    revert_reason: accepted ? null : await env.revertReason(spec),
    event_types: [...new Set(r.events.map((e) => e.type))],
    receipts: h === null ? null : { before: await env.receiptsAt(h - 1), after: await env.receiptsAt(h) },
    state: Object.keys(before).map((name) => ({ name, before: before[name]!, after: after[name] ?? "" })),
  };
}

const showArg = (a: unknown): string => {
  const s = typeof a === "bigint" ? a.toString() : typeof a === "string" ? a : JSON.stringify(a);
  return s.length > 42 ? `${s.slice(0, 18)}…(${(s.length - 2) / 2} bytes)` : s;
};

/**
 * The two steps. Step 1 attests the latest finished day of `system` that has no reading; when every day has one, it
 * sends a valid reading for `firstDay` again, so a call that reaches the contract fails there with `AlreadyAttested`
 * and one the chain refuses fails before it.
 */
export function entrySteps(o: {
  cfg: NativeEntryConfig;
  freeDay: number | null;
  firstDay: number;
  whFor: (day: number) => number;
  sign: (day: number, wh: number) => `0x${string}`;
}): StepSpec[] {
  const day = o.freeDay ?? o.firstDay;
  const wh = o.whFor(day);
  return [
    {
      step: 1,
      question: "Does the chain accept a hybrid-signed MsgCrossVMCall into Mentari.attest with no EVM window open?",
      functionName: "attest",
      args: [o.cfg.system, day, BigInt(wh), o.sign(day, wh)],
      contractWould: o.freeDay === null ? "revert AlreadyAttested" : "mint the reading",
    },
    {
      step: 2,
      question: "Is the nested bridge call accepted: Mentari.retire, which calls 0x…0901 into the Native receipts book?",
      functionName: "retire",
      args: [BigInt(o.cfg.retireWh), o.cfg.memo],
      contractWould: "burn the certificates and write one Native receipt",
    },
  ];
}

/** Case H in `evidence/testnet.json` `cases`, after A to G. */
export interface NativeEntryRecord {
  id: "H";
  title: string;
  sender: { role: string; cosmos: string; evm: string };
  ranAt: string;
  steps: StepRecord[];
}

/** Keep earlier steps, replace the ones run again, in step order. */
export function mergeSteps(prev: readonly StepRecord[] | undefined, added: readonly StepRecord[]): StepRecord[] {
  const byStep = new Map<number, StepRecord>();
  for (const s of prev ?? []) byStep.set(s.step, s);
  for (const s of added) byStep.set(s.step, s);
  return [...byStep.values()].sort((a, b) => a.step - b.step);
}
