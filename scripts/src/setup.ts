import { closeSync, constants, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { bytesToHex, getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import {
  attestDays,
  chainDay,
  deploy,
  registerSystems,
  type Artifact,
  type MeterRun,
  type Sent,
  type SystemPlan,
} from "./chain.js";
import type { MeterConfig } from "./meter.js";

/**
 * One testnet setup run: deploy the two contracts unless config/app.json already names them, register the
 * systems, attest the backfill window, and say what to write back. Every step reads first, so the run can be
 * repeated after a stop and sends only what is missing.
 */

/** The `contracts` block of config/app.json. Empty strings and 0 mean "not deployed yet". */
export interface ContractsConfig {
  mentari: string;
  atomicityProbe: string;
  mentariDeployBlock: number;
}

export interface SetupResult {
  contracts: ContractsConfig;
  /** Contract creation transactions sent in this run (empty when both were already there). */
  deployed: { name: "Mentari" | "AtomicityProbe"; address: Address; tx: Hex }[];
  sent: Sent[];
}

async function hasCode(pub: PublicClient, address: string): Promise<boolean> {
  const code = await pub.getCode({ address: address as Address });
  return !!code && code !== "0x";
}

/**
 * Both contracts on chain. Addresses already in the config are kept when code is there. An address in the
 * config with no code means the config points at another chain, so the run stops instead of deploying a
 * second copy over it. Exactly one address set is the same kind of mistake.
 */
export async function deployIfMissing(
  run: Pick<MeterRun, "pub" | "wallet">,
  current: ContractsConfig,
  arts: { mentari: Artifact; probe: Artifact },
  args: { registrar: Address; receiptsBook: string; maxSunHoursX10: number },
): Promise<Pick<SetupResult, "contracts" | "deployed">> {
  const set = [current.mentari, current.atomicityProbe].filter((a) => a !== "");
  if (set.length === 2) {
    for (const a of set) {
      if (!isAddress(a)) throw new Error(`config contracts: ${a} is not an address`);
      if (!(await hasCode(run.pub, a))) throw new Error(`config contracts: no code at ${a} on this chain`);
    }
    if (!Number.isInteger(current.mentariDeployBlock) || current.mentariDeployBlock <= 0)
      throw new Error("config contracts: mentariDeployBlock is missing");
    return { contracts: current, deployed: [] };
  }
  if (set.length === 1) throw new Error("config contracts: only one of the two addresses is set");
  const m = await deploy(run.pub, run.wallet, arts.mentari, [args.registrar, args.receiptsBook, args.maxSunHoursX10]);
  const p = await deploy(run.pub, run.wallet, arts.probe, [args.receiptsBook]);
  return {
    contracts: { mentari: m.address, atomicityProbe: p.address, mentariDeployBlock: Number(m.block) },
    deployed: [
      { name: "Mentari", address: m.address, tx: m.tx },
      { name: "AtomicityProbe", address: p.address, tx: p.tx },
    ],
  };
}

/**
 * Deploy when needed, then register every system with its first day at the start of the backfill window and
 * attest the finished days in that window. Systems registered on an earlier run keep their first day.
 */
export async function setupTestnet(opts: {
  run: Omit<MeterRun, "mentari" | "abi">;
  current: ContractsConfig;
  arts: { mentari: Artifact; probe: Artifact };
  receiptsBook: string;
  registrar: Address;
  cfg: MeterConfig;
  plans: readonly SystemPlan[];
}): Promise<SetupResult> {
  const { run, current, arts, cfg, plans } = opts;
  const d = await deployIfMissing(run, current, arts, {
    registrar: opts.registrar,
    receiptsBook: opts.receiptsBook,
    maxSunHoursX10: cfg.maxSunHoursX10,
  });
  const meterRun: MeterRun = { ...run, mentari: getAddress(d.contracts.mentari), abi: arts.mentari.abi };
  const firstDay = (await chainDay(run.pub)) - cfg.backfillDays;
  const registered = await registerSystems(meterRun, opts.registrar, plans, firstDay);
  const attested = await attestDays(meterRun, cfg, plans, cfg.backfillDays);
  return { ...d, sent: [...registered, ...attested] };
}

/** Write a file through a temporary name in the same folder, so a reader never sees half of it. */
function replaceFile(path: string, body: string, mode: number): void {
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
  try {
    writeSync(fd, body);
  } catch (err) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw err;
  }
  closeSync(fd);
  renameSync(tmp, path);
}

/** Put the deployed addresses into config/app.json, leaving every other key as it was. */
export function writeContractsConfig(appJson: string, contracts: ContractsConfig): void {
  const json = JSON.parse(readFileSync(appJson, "utf8")) as Record<string, unknown>;
  if (typeof json.contracts !== "object" || json.contracts === null)
    throw new Error(`${appJson}: no contracts block`);
  json.contracts = { ...(json.contracts as object), ...contracts };
  replaceFile(appJson, JSON.stringify(json, null, 2) + "\n", 0o644);
}

/** The file the server's daily meter job reads from its read-only key folder. */
export const METER_KEYS_FILE = "meter-keys.json";

/**
 * Write the meter keys file (mode 600) into the key folder. The folder must be absolute and outside the
 * repository, like the accounts file. Nothing about the keys is returned or logged.
 */
export function writeMeterKeys(
  dir: string,
  repoRoot: string,
  keys: { sender: Hex; meters: readonly { address: Address; pqcSecretKey: Uint8Array }[] },
): string {
  if (!isAbsolute(dir)) throw new Error("key folder must be an absolute path");
  const rel = relative(resolve(repoRoot), resolve(dir));
  if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error("key folder is inside the repository; keep it outside");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const body = {
    sender: keys.sender,
    meters: keys.meters.map((m) => ({ address: getAddress(m.address), pqcSecretKey: bytesToHex(m.pqcSecretKey) })),
  };
  const path = join(dir, METER_KEYS_FILE);
  replaceFile(path, JSON.stringify(body, null, 2) + "\n", 0o600);
  return path;
}
