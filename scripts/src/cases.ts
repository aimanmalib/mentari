import { getAddress, parseEventLogs, type Abi, type Address, type Hex, type PublicClient } from "viem";
import type { BookReader } from "./book.js";
import type { Wallet } from "./chain.js";
import { attestMessage, maxWh, simulatedWh, type MeterConfig, type MeterSystem } from "./meter.js";
import { describeRevert } from "./revert.js";

/**
 * The testnet cases (A to G) that show what Mentari does and refuses, each sent as one real transaction from the demo
 * sender and recorded with the receipts book count before and after. A case that must revert is first simulated: it is
 * sent only when the simulation fails with the expected error, so a wrong setup costs no transaction. Its revert
 * reason comes from that simulation, because a mined receipt only says "reverted".
 */

export type CaseId = "A" | "B" | "C" | "D" | "E" | "E2" | "F" | "G";
export const CASE_ORDER: readonly CaseId[] = ["A", "B", "C", "D", "E", "E2", "F", "G"];

/** The `cases` block of config/app.json, plus the values it shares with the demo. */
export interface CasesConfig {
  retireWh: number;
  memo: string;
  probeNote: string;
  /** The system E, E2 and F attest for. */
  system: number;
  /** The account whose ML-DSA-87 key signs the E reading in place of the system's meter. */
  wrongKeyRole: string;
  /** An address with no registered ML-DSA-87 key (case G). */
  unkeyedRecipient: string;
  transferWh: number;
  /** A Native contract that is not on the bridge allowlist (case D). */
  notAllowlistedTarget: string;
  /** Gas limit of each case that must revert; estimating it would fail. */
  revertGas: number;
}

export interface CaseSpec {
  id: CaseId;
  title: string;
  contract: "mentari" | "probe";
  functionName: string;
  args: readonly unknown[];
  expect: "success" | "revert";
  /** For a revert: text the simulated error must contain. */
  reason?: string;
}

export interface CaseRecord {
  id: CaseId;
  title: string;
  expect: "success" | "revert";
  status: "success" | "reverted";
  contract: Address;
  function: string;
  evm_tx: Hex;
  cosmos_tx: string | null;
  height: number;
  gas_used: number;
  revert_reason: string | null;
  receipts: { before: number; after: number };
  retirements: { before: number; after: number };
  receipt?: { id: number; sender: string; note: string };
}

export interface CasesEnv {
  pub: PublicClient;
  wallet: Wallet;
  mentari: { address: Address; abi: Abi };
  probe: { address: Address; abi: Abi };
  book: BookReader;
  /** The Mentari contract's own Native (`qor1…`) address, the sender a case A receipt must show. */
  mentariNative: string;
  /** How often to look for the Cosmos transaction while the node indexes it (default 5 tries, 2 s apart). */
  cosmosLookup?: { tries: number; waitMs: number };
  log?: (line: string) => void;
}

/** Signs `message` with the ML-DSA-87 key of the account with this role. */
export type RoleSigner = (role: string, message: Uint8Array) => Hex;

/** Cases that need nothing from the chain to build. */
export function fixedCases(cfg: CasesConfig): CaseSpec[] {
  return [
    { id: "A", title: "Retire certificates", contract: "mentari", functionName: "retire", args: [BigInt(cfg.retireWh), cfg.memo], expect: "success" },
    { id: "B", title: "Native write, then the EVM side reverts", contract: "probe", functionName: "recordThenRevert", args: [cfg.probeNote], expect: "revert", reason: "RevertedAfterNativeWrite" },
    { id: "C", title: "The Native contract refuses the message", contract: "probe", functionName: "nativeRefuses", args: [], expect: "revert", reason: "BridgeCallFailed" },
    { id: "D", title: "A Native contract not on the bridge allowlist", contract: "probe", functionName: "callTarget", args: [cfg.notAllowlistedTarget, cfg.probeNote], expect: "revert", reason: "not allowlisted" },
    { id: "G", title: "Transfer to an account without an ML-DSA-87 key", contract: "mentari", functionName: "transfer", args: [getAddress(cfg.unkeyedRecipient), BigInt(cfg.transferWh)], expect: "revert", reason: "NotQuantumReady" },
  ];
}

/**
 * Cases E, E2 and F, which attest readings for one system. E2 repeats a day the chain already holds, with a correct
 * signature. E (another account's key) and F (one watt-hour over the cap, correct signature) need a finished day
 * with no reading yet, so the only fault is the one shown; while there is none they are left out.
 */
export async function attestCases(
  env: Pick<CasesEnv, "pub" | "mentari">,
  cfg: CasesConfig,
  meters: MeterConfig,
  sign: RoleSigner,
): Promise<CaseSpec[]> {
  const system = meters.systems.find((s) => s.id === cfg.system);
  if (!system) throw new Error(`config cases.system ${cfg.system} is not in config/meter.json`);
  const read = (functionName: string, args: readonly unknown[] = []) =>
    env.pub.readContract({ address: env.mentari.address, abi: env.mentari.abi, functionName, args });
  const chainId = await env.pub.getChainId();
  const today = Number(await read("currentDay"));
  const { firstDay } = (await read("system", [system.id])) as { firstDay: number };
  const attest = (id: CaseId, title: string, day: number, wh: number, role: string, reason: string): CaseSpec => {
    const sig = sign(role, attestMessage(chainId, env.mentari.address, system.id, day, wh));
    return { id, title, contract: "mentari", functionName: "attest", args: [system.id, day, BigInt(wh), sig], expect: "revert", reason };
  };
  const meterRole = `meter ${system.label}`;
  const out: CaseSpec[] = [];
  if ((await read("attested", [system.id, firstDay])) as boolean)
    out.push(attest("E2", "A second reading for the same day", firstDay, simulatedWh(meters, system, firstDay), meterRole, "AlreadyAttested"));
  const free = await freeDay(read, system, firstDay, today);
  if (free !== null) {
    out.push(attest("E", "A reading signed with another account's key", free, simulatedWh(meters, system, free), cfg.wrongKeyRole, "BadSignature"));
    out.push(attest("F", "A reading over the system's capacity", free, maxWh(system.capacityW, meters.maxSunHoursX10) + 1, meterRole, "WhOutOfRange"));
  }
  return out;
}

/** The latest finished day, on or after `firstDay`, that has no reading. */
async function freeDay(
  read: (fn: string, args: readonly unknown[]) => Promise<unknown>,
  system: MeterSystem,
  firstDay: number,
  today: number,
): Promise<number | null> {
  for (let d = today - 1; d >= firstDay; d--) if (!((await read("attested", [system.id, d])) as boolean)) return d;
  return null;
}

/** Specs still to send, in case order: those not in `done` and not left out by `attestCases`. */
export function pendingCases(specs: CaseSpec[], done: readonly { id: string }[]): CaseSpec[] {
  const have = new Set(done.map((c) => c.id));
  const order = (s: CaseSpec) => CASE_ORDER.indexOf(s.id);
  return specs.filter((s) => !have.has(s.id)).sort((a, b) => order(a) - order(b));
}

/** Simulate, send, wait, then record one case. Throws (sending nothing) when the simulation is not what the case expects. */
export async function runCase(env: CasesEnv, spec: CaseSpec, revertGas: number): Promise<CaseRecord> {
  const target = env[spec.contract];
  const call = { address: target.address, abi: target.abi, functionName: spec.functionName, args: spec.args, account: env.wallet.account };
  let reason: string | null = null;
  try {
    await env.pub.simulateContract(call);
  } catch (err) {
    reason = describeRevert(err) ?? null;
    if (spec.expect === "success" || !reason) throw new Error(`case ${spec.id}: the simulation failed (${reason ?? errorText(err)}); not sent`);
  }
  if (spec.expect === "revert") {
    if (reason === null) throw new Error(`case ${spec.id}: the call would succeed; not sent`);
    if (!reason.includes(spec.reason ?? "")) throw new Error(`case ${spec.id}: expected ${spec.reason}, simulation gave ${reason}; not sent`);
  }

  const hash = await env.wallet.writeContract({
    ...call,
    chain: env.wallet.chain,
    ...(spec.expect === "revert" ? { gas: BigInt(revertGas) } : {}),
  });
  const r = await env.pub.waitForTransactionReceipt({ hash });
  const height = Number(r.blockNumber);
  const retirementsAt = async (h: number) =>
    Number(await env.pub.readContract({ address: env.mentari.address, abi: env.mentari.abi, functionName: "retirementsCount", blockNumber: BigInt(h) }));
  const record: CaseRecord = {
    id: spec.id,
    title: spec.title,
    expect: spec.expect,
    status: r.status,
    contract: target.address,
    function: spec.functionName,
    evm_tx: hash,
    cosmos_tx: await retry(() => env.book.cosmosTxOf(hash), env.cosmosLookup),
    height,
    gas_used: Number(r.gasUsed),
    revert_reason: reason,
    receipts: { before: await env.book.countAt(height - 1), after: await env.book.countAt(height) },
    retirements: { before: await retirementsAt(height - 1), after: await retirementsAt(height) },
  };
  if (spec.expect === "success") record.receipt = await checkRetirement(env, r.logs, spec);
  env.log?.(`case ${spec.id}: ${r.status} at block ${height}, receipts ${record.receipts.before} -> ${record.receipts.after}: ${hash}`);
  if ((r.status === "success") !== (spec.expect === "success")) throw Object.assign(new Error(`case ${spec.id}: ${r.status}, expected ${spec.expect}: ${hash}`), { record });
  return record;
}

/** Case A: the receipt the retirement names must come from the Mentari contract and carry the expected note. */
async function checkRetirement(env: CasesEnv, logs: Parameters<typeof parseEventLogs>[0]["logs"], spec: CaseSpec) {
  const [ev] = parseEventLogs({ abi: env.mentari.abi, eventName: "Retired", logs }) as unknown as {
    args: { n: bigint; holder: Address; wh: bigint; receiptId: bigint; memo: string };
  }[];
  if (!ev) throw new Error(`case ${spec.id}: no Retired event`);
  const { n, holder, wh, receiptId, memo } = ev.args;
  const receipt = await env.book.receipt(Number(receiptId));
  const note = `MTR1 n=${n} wh=${wh} by=${holder.toLowerCase()} m=${memo}`;
  if (receipt.sender !== env.mentariNative) throw new Error(`case ${spec.id}: receipt ${receiptId} sender ${receipt.sender}, expected ${env.mentariNative}`);
  if (receipt.note !== note) throw new Error(`case ${spec.id}: receipt ${receiptId} note differs from the retirement`);
  return { id: receipt.id, sender: receipt.sender, note: receipt.note };
}

async function retry<T>(fn: () => Promise<T | null>, { tries, waitMs } = { tries: 5, waitMs: 2000 }): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const v = await fn().catch(() => null);
    if (v !== null) return v;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  return null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n")[0] ?? err.message) : String(err);
}

/** `evidence/testnet.json`: where the cases ran, and one record per case in case order. */
export interface TestnetEvidence {
  chainId: string;
  evmChainId: number;
  evmRpc: string;
  rest: string;
  contracts: Record<string, string>;
  sender: { role: string; evm: string };
  revertReasonFrom: string;
  cases: CaseRecord[];
  /** Case H (the Native-entry experiment), written by `pnpm native-entry`; carried over untouched. */
  nativeEntry?: unknown;
}

/** Adds new records to the evidence; a case already recorded is never replaced. Case H is kept as it was. */
export function mergeEvidence(
  prev: Partial<TestnetEvidence> | undefined,
  head: Omit<TestnetEvidence, "cases">,
  added: readonly CaseRecord[],
): TestnetEvidence {
  const kept = Array.isArray(prev?.cases) ? prev.cases : [];
  const have = new Set(kept.map((c) => c.id));
  const cases = [...kept, ...added.filter((c) => !have.has(c.id))];
  cases.sort((a, b) => CASE_ORDER.indexOf(a.id) - CASE_ORDER.indexOf(b.id));
  return prev?.nativeEntry === undefined ? { ...head, cases } : { ...head, cases, nativeEntry: prev.nativeEntry };
}

export const REVERT_REASON_FROM =
  "eth_call of the same call from the same sender just before it was sent; a mined receipt only says reverted";
