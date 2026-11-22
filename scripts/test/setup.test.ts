import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseMeterKeys } from "../../server/src/meter/keys.js";
import { chainDay, loadArtifact, type SystemPlan } from "../src/chain.js";
import type { MeterConfig } from "../src/meter.js";
import {
  METER_KEYS_FILE,
  deployIfMissing,
  setupTestnet,
  writeContractsConfig,
  writeMeterKeys,
  type ContractsConfig,
} from "../src/setup.js";
import { indexOf } from "../testnet.js";
import { startAnvil, type LocalChain } from "./lib/anvil.js";

/** Frozen fixture, so a change to config/meter.json never turns these tests red. */
const CFG: MeterConfig = {
  simulated: true,
  maxSunHoursX10: 80,
  backfillDays: 3,
  model: { seed: "fixture-seed", meanSunHours: 4.6, spreadSunHours: 1.2 },
  systems: [
    { id: 1, label: "A", capacityW: 5000 },
    { id: 2, label: "B", capacityW: 8200 },
  ],
};
const BOOK = "qor1fixturebook";
const EMPTY: ContractsConfig = { mentari: "", atomicityProbe: "", mentariDeployBlock: 0 };

vi.setConfig({ testTimeout: 60_000 });

const arts = { mentari: loadArtifact("Mentari"), probe: loadArtifact("AtomicityProbe") };
let chain: LocalChain;
let registrar: Address, sender: Address, outsider: Address;
let plans: SystemPlan[];
const temps: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "mentari-setup-"));
  temps.push(d);
  return d;
}

beforeAll(async () => {
  chain = await startAnvil();
  const [, reg, mA, mB, prod, send, out] = chain.accounts as Address[];
  [registrar, sender, outsider] = [reg!, send!, out!];
  for (const a of [registrar, mA!, mB!, prod!]) await chain.makeQuantumReady(a);
  plans = CFG.systems.map((s, i) => ({ ...s, meter: [mA!, mB!][i]!, producer: prod! }));
}, 60_000);
afterAll(() => chain?.stop());
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const baseRun = () => ({ pub: chain.pub, wallet: chain.wallet(sender), sign: chain.sign });
const args = () => ({ registrar, receiptsBook: BOOK, maxSunHoursX10: 80 });

describe("deployIfMissing", () => {
  it("deploys both contracts once and keeps them on the next run", async () => {
    const first = await deployIfMissing(baseRun(), EMPTY, arts, args());
    expect(first.deployed.map((d) => d.name)).toEqual(["Mentari", "AtomicityProbe"]);
    expect(first.contracts.mentariDeployBlock).toBeGreaterThan(0);
    const again = await deployIfMissing(baseRun(), first.contracts, arts, args());
    expect(again).toEqual({ contracts: first.contracts, deployed: [] });
  });

  it("stops when the config names an address with no code on this chain", async () => {
    const bad = { mentari: outsider, atomicityProbe: outsider, mentariDeployBlock: 1 };
    await expect(deployIfMissing(baseRun(), bad, arts, args())).rejects.toThrow(/no code at/);
  });

  it("stops when only one address is set", async () => {
    const half = { ...EMPTY, mentari: outsider };
    await expect(deployIfMissing(baseRun(), half, arts, args())).rejects.toThrow(/only one/);
  });

  it("stops when the deploy block is missing", async () => {
    const { contracts } = await deployIfMissing(baseRun(), EMPTY, arts, args());
    await expect(deployIfMissing(baseRun(), { ...contracts, mentariDeployBlock: 0 }, arts, args())).rejects.toThrow(
      /mentariDeployBlock/,
    );
  });
});

describe("setupTestnet", () => {
  it("deploys, registers and backfills, then sends nothing on a second run", async () => {
    const opts = { run: baseRun(), arts, receiptsBook: BOOK, registrar, cfg: CFG, plans };
    const first = await setupTestnet({ ...opts, current: EMPTY });
    const today = await chainDay(chain.pub);
    expect(first.deployed).toHaveLength(2);
    expect(first.sent.filter((s) => s.kind === "register").map((s) => [s.id, s.day])).toEqual([
      [1, today - 3],
      [2, today - 3],
    ]);
    expect(first.sent.filter((s) => s.kind === "attest")).toHaveLength(2 * 3);

    const second = await setupTestnet({ ...opts, current: first.contracts });
    expect(second).toEqual({ contracts: first.contracts, deployed: [], sent: [] });
  });
});

describe("writeContractsConfig", () => {
  it("replaces the contracts block and leaves every other key", () => {
    const path = join(tempDir(), "app.json");
    const before = { network: { evmChainId: 9800 }, contracts: { ...EMPTY, note: "kept" }, web: { a: [1, 2] } };
    writeFileSync(path, JSON.stringify(before, null, 2) + "\n");
    const c = { mentari: "0x" + "11".repeat(20), atomicityProbe: "0x" + "22".repeat(20), mentariDeployBlock: 42 };
    writeContractsConfig(path, c);
    const raw = readFileSync(path, "utf8");
    expect(raw.endsWith("}\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual({ ...before, contracts: { ...c, note: "kept" } });
  });

  it("refuses a file with no contracts block", () => {
    const path = join(tempDir(), "app.json");
    writeFileSync(path, "{}\n");
    expect(() => writeContractsConfig(path, EMPTY)).toThrow(/no contracts block/);
  });
});

describe("writeMeterKeys", () => {
  const keys = {
    sender: `0x${"ab".repeat(32)}` as const,
    meters: [{ address: "0x" + "cd".repeat(20), pqcSecretKey: new Uint8Array(4896).fill(7) }] as {
      address: Address;
      pqcSecretKey: Uint8Array;
    }[],
  };

  it("writes a mode 600 file the server reads back", () => {
    const dir = join(tempDir(), "keys");
    const path = writeMeterKeys(dir, "/nonexistent-repo", keys);
    expect(path).toBe(join(dir, METER_KEYS_FILE));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const parsed = parseMeterKeys(readFileSync(path, "utf8"));
    expect(parsed.sender).toBe(keys.sender);
    expect([...parsed.meters.values()][0]).toEqual(keys.meters[0]!.pqcSecretKey);
  });

  it("replaces an older file", () => {
    const dir = tempDir();
    writeFileSync(join(dir, METER_KEYS_FILE), "old", { mode: 0o600 });
    writeMeterKeys(dir, "/nonexistent-repo", keys);
    expect(() => parseMeterKeys(readFileSync(join(dir, METER_KEYS_FILE), "utf8"))).not.toThrow();
  });

  it("refuses a folder inside the repository or a relative one", () => {
    const repo = tempDir();
    expect(() => writeMeterKeys(join(repo, "state"), repo, keys)).toThrow(/inside the repository/);
    expect(() => writeMeterKeys("keys", repo, keys)).toThrow(/absolute/);
  });
});

describe("indexOf", () => {
  const app = { accounts: { "0": "funder and deployer", "1": "registrar", "2": "meter A", "3": "meter A" } } as never;

  it("finds the account a role names", () => {
    expect(indexOf(app, "registrar")).toBe(1);
  });

  it("refuses a missing or doubled role", () => {
    expect(() => indexOf(app, "producer")).toThrow(/found 0/);
    expect(() => indexOf(app, "meter A")).toThrow(/found 2/);
  });
});
