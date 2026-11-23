import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  ContractFunctionRevertedError,
  bytesToHex,
  getAddress,
  type Abi,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import {
  attestMessage,
  daysToAttest,
  registerMessage,
  simulatedWh,
  type MeterConfig,
  type MeterSystem,
} from "./meter.js";

/**
 * The chain side of the meters: deploy the contracts, register the systems and attest the finished days.
 * Every step reads the chain first and skips what is already there, so a run that stops halfway can be
 * started again. Every write is simulated before it is sent, so a call the contract would refuse fails here
 * with the contract's error name and costs nothing.
 *
 * Signing is passed in. On testnet it is ML-DSA-87 with each account's registered key; in tests it is the
 * stand-in signature the test precompile accepts.
 */

/** Signs `message` as `account` and returns the `sig` argument for `registerSystem` or `attest`. */
export type PqcSigner = (account: Address, message: Uint8Array) => Hex;

export type Wallet = WalletClient<Transport, Chain | undefined, Account>;

export interface Artifact {
  abi: Abi;
  bytecode: Hex;
}

const OUT = fileURLToPath(new URL("../../contracts/out/", import.meta.url));

/** ABI and creation code from `forge build` output (`contracts/out/<Name>.sol/<Name>.json`). */
export function loadArtifact(name: string, outDir: string = OUT): Artifact {
  let raw: string;
  try {
    raw = readFileSync(`${outDir}/${name}.sol/${name}.json`, "utf8");
  } catch {
    throw new Error(`no build output for ${name}; run 'forge build' in contracts/`);
  }
  const json = JSON.parse(raw) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export interface Deployed {
  address: Address;
  block: bigint;
  tx: Hex;
}

/** Deploys a contract and waits for it. Fails unless the receipt succeeded and code is at the address. */
export async function deploy(
  pub: PublicClient,
  wallet: Wallet,
  artifact: Artifact,
  args: readonly unknown[],
): Promise<Deployed> {
  const tx = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
    account: wallet.account,
    chain: wallet.chain,
  });
  const receipt = await pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error(`deploy ${tx} failed`);
  const code = await pub.getCode({ address: receipt.contractAddress });
  if (!code || code === "0x") throw new Error(`no code at ${receipt.contractAddress}`);
  return { address: receipt.contractAddress, block: receipt.blockNumber, tx };
}

/** One system as config/meter.json describes it plus the accounts that run it. */
export interface SystemPlan extends MeterSystem {
  meter: Address;
  producer: Address;
}

export interface MeterRun {
  pub: PublicClient;
  wallet: Wallet;
  mentari: Address;
  abi: Abi;
  sign: PqcSigner;
  /**
   * Sends one simulated contract call another way and resolves with its transaction hash once it succeeded (the
   * server's Native route, decision 0026). Without it, `wallet` sends an EVM transaction.
   */
  send?: (functionName: string, args: readonly unknown[]) => Promise<string>;
  /** Log line per transaction: public data only (ids, days, amounts, hashes). */
  log?: (line: string) => void;
}

export interface Sent {
  kind: "register" | "attest";
  id: number;
  day: number;
  wh?: number;
  /** EVM transaction hash, or the Cosmos one when `send` sent it from the Native lane. */
  tx: string;
}

/** The UTC day the contract sees now: latest block timestamp / 1 day. */
export async function chainDay(pub: PublicClient): Promise<number> {
  const block = await pub.getBlock({ blockTag: "latest" });
  return Number(block.timestamp / 86_400n);
}

/** Registered system on chain, or null when `system(id)` reverts with `UnknownSystem`. */
export async function readSystem(
  run: Pick<MeterRun, "pub" | "mentari" | "abi">,
  id: number,
): Promise<{ meter: Address; producer: Address; capacityW: number; firstDay: number } | null> {
  try {
    const s = (await run.pub.readContract({
      address: run.mentari,
      abi: run.abi,
      functionName: "system",
      args: [id],
    })) as { meter: Address; producer: Address; capacityW: number; firstDay: number };
    return s;
  } catch (err) {
    if (revertName(err) === "UnknownSystem") return null;
    throw err;
  }
}

/**
 * Registers each system that is not on chain yet, signed by the registrar over `registerMessage` at the
 * contract's current nonce. A system already registered with different accounts or capacity is an error:
 * the chain cannot be changed to match the config, so the run stops instead of attesting against it.
 */
export async function registerSystems(
  run: MeterRun,
  registrar: Address,
  systems: readonly SystemPlan[],
  firstDay: number,
): Promise<Sent[]> {
  const chainId = await run.pub.getChainId();
  const sent: Sent[] = [];
  for (const s of systems) {
    const onChain = await readSystem(run, s.id);
    if (onChain) {
      checkSame(s, onChain);
      continue;
    }
    const nonce = (await read(run, "nonce", [])) as bigint;
    const sys = { id: s.id, meter: s.meter, producer: s.producer, capacityW: s.capacityW, firstDay };
    const message = registerMessage(chainId, run.mentari, nonce, sys);
    await sameBytes(run, "registerMessage", [s.id, s.meter, s.producer, s.capacityW, firstDay], message);
    const sig = run.sign(registrar, message);
    const tx = await write(run, "registerSystem", [s.id, s.meter, s.producer, s.capacityW, firstDay, sig]);
    sent.push({ kind: "register", id: s.id, day: firstDay, tx });
    run.log?.(`register system ${s.id} (${s.label}) first day ${firstDay}: ${tx}`);
  }
  return sent;
}

/**
 * Attests every finished day in the backfill window that the chain has not seen, oldest first, with the
 * simulated reading for that day signed by the system's meter. Run again after success, it sends nothing.
 */
export async function attestDays(
  run: MeterRun,
  cfg: MeterConfig,
  systems: readonly SystemPlan[],
  backfillDays: number = cfg.backfillDays,
): Promise<Sent[]> {
  const chainId = await run.pub.getChainId();
  const today = await chainDay(run.pub);
  const sent: Sent[] = [];
  for (const s of systems) {
    const onChain = await readSystem(run, s.id);
    if (!onChain) throw new Error(`system ${s.id} is not registered`);
    checkSame(s, onChain);
    const attested = new Set<number>();
    for (let d = Math.max(onChain.firstDay, today - backfillDays); d < today; d++) {
      if ((await read(run, "attested", [s.id, d])) as boolean) attested.add(d);
    }
    const days = daysToAttest({ today, firstDay: onChain.firstDay, backfillDays, attested });
    for (const day of days) {
      const wh = simulatedWh(cfg, s, day);
      const message = attestMessage(chainId, run.mentari, s.id, day, wh);
      await sameBytes(run, "attestMessage", [s.id, day, BigInt(wh)], message);
      const tx = await write(run, "attest", [s.id, day, BigInt(wh), run.sign(onChain.meter, message)]);
      sent.push({ kind: "attest", id: s.id, day, wh, tx });
      run.log?.(`attest system ${s.id} (${s.label}) day ${day} ${wh} Wh: ${tx}`);
    }
  }
  return sent;
}

/** The contract error name inside a viem error, or undefined. */
export function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
}

function checkSame(
  s: SystemPlan,
  onChain: { meter: Address; producer: Address; capacityW: number },
): void {
  if (
    getAddress(onChain.meter) !== getAddress(s.meter) ||
    getAddress(onChain.producer) !== getAddress(s.producer) ||
    onChain.capacityW !== s.capacityW
  ) {
    throw new Error(`system ${s.id} is registered on chain with other accounts or capacity`);
  }
}

function read(run: Pick<MeterRun, "pub" | "mentari" | "abi">, fn: string, args: readonly unknown[]) {
  return run.pub.readContract({ address: run.mentari, abi: run.abi, functionName: fn, args });
}

/** Refuses to sign when the bytes built here differ from the bytes the contract will check. */
async function sameBytes(run: MeterRun, fn: string, args: readonly unknown[], local: Uint8Array) {
  const onChain = (await read(run, fn, args)) as Hex;
  if (onChain.toLowerCase() !== bytesToHex(local))
    throw new Error(`${fn}: bytes built here differ from the contract's`);
}

async function write(run: MeterRun, fn: string, args: readonly unknown[]): Promise<string> {
  const { request } = await run.pub.simulateContract({
    address: run.mentari,
    abi: run.abi,
    functionName: fn,
    args,
    account: run.wallet.account,
  });
  if (run.send) return run.send(fn, args);
  const tx = await run.wallet.writeContract(request);
  const receipt = await run.pub.waitForTransactionReceipt({ hash: tx });
  if (receipt.status !== "success") throw new Error(`${fn} ${tx} reverted`);
  return tx;
}
