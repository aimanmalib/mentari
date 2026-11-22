import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePqcKeypair, pqcVerify } from "@qorechain/sdk";
import { getAddress, hexToBytes, type Address } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  chainDay,
  deploy,
  loadArtifact,
  registerSystems,
  type MeterRun,
  type SystemPlan,
} from "../../scripts/src/chain.js";
import { attestMessage } from "../../scripts/src/meter.js";
import { startAnvil, type LocalChain } from "../../scripts/test/lib/anvil.js";
import { mentariMeterAbi } from "../src/meter/abi.js";
import { METER_KEYS_FILE } from "../src/meter/keys.js";
import { chainMeterJob, liveMeterJob, meterSigner, plansFromChain } from "../src/meter/live.js";
import { meterModel } from "./fixture.js";

// Each test sends real transactions to a local node; shared CI machines can be slow.
vi.setConfig({ testTimeout: 60_000 });

const CFG = meterModel();
const BOOK = "qor1fixturebook";
const mentariArt = loadArtifact("Mentari");
let chain: LocalChain;
let registrar: Address, producer: Address, sender: Address;
let meters: Address[];

beforeAll(async () => {
  chain = await startAnvil();
  const [, reg, mA, mB, prod, send] = chain.accounts as Address[];
  [registrar, producer, sender] = [reg!, prod!, send!];
  meters = [mA!, mB!];
  for (const a of [registrar, ...meters, producer]) await chain.makeQuantumReady(a);
}, 60_000);
afterAll(() => chain?.stop());

/** A fresh contract with the fixture systems registered `daysBack` days ago, driven through the server's ABI. */
async function registered(daysBack: number): Promise<MeterRun> {
  const wallet = chain.wallet(sender);
  const d = await deploy(chain.pub, wallet, mentariArt, [registrar, BOOK, CFG.maxSunHoursX10]);
  const run: MeterRun = { pub: chain.pub, wallet, mentari: d.address, abi: mentariMeterAbi, sign: chain.sign };
  const plans: SystemPlan[] = CFG.systems.map((s, i) => ({ ...s, meter: meters[i]!, producer }));
  await registerSystems({ ...run, abi: mentariArt.abi }, registrar, plans, (await chainDay(chain.pub)) - daysBack);
  return run;
}

const attested = async (run: MeterRun, id: number, day: number) =>
  run.pub.readContract({ address: run.mentari, abi: mentariMeterAbi, functionName: "attested", args: [id, day] });

describe("chainMeterJob", () => {
  it("attests yesterday for every system, then sends nothing on a second run", async () => {
    const run = await registered(3);
    const job = chainMeterJob({ cfg: CFG, run, meters: new Set(meters), windowDays: 1 });
    expect(job.ready()).toBe(true);
    expect(await job.run()).toBe(CFG.systems.length);
    const today = await chainDay(chain.pub);
    for (const s of CFG.systems) {
      expect(await attested(run, s.id, today - 1)).toBe(true);
      expect(await attested(run, s.id, today - 2)).toBe(false);
    }
    expect(await job.run()).toBe(0);
  });

  it("reads each system's meter and producer from the chain", async () => {
    const run = await registered(1);
    const plans = await plansFromChain(run, CFG);
    expect(plans.map((p) => [p.id, p.meter, p.producer])).toEqual([
      [1, meters[0], producer],
      [2, meters[1], producer],
    ]);
  });

  it("stops before sending anything when a registered meter has no key", async () => {
    const run = await registered(1);
    const job = chainMeterJob({ cfg: CFG, run, meters: new Set([meters[0]!]), windowDays: 1 });
    await expect(job.run()).rejects.toThrow(`no meter key for system 2 (${meters[1]})`);
    expect(await attested(run, 1, (await chainDay(chain.pub)) - 1)).toBe(false);
  });

  it("fails on a configured system the chain has not registered", async () => {
    const run = await registered(1);
    const more = { ...CFG, systems: [...CFG.systems, { id: 9, label: "Z", capacityW: 1000 }] };
    const job = chainMeterJob({ cfg: more, run, meters: new Set(meters), windowDays: 1 });
    await expect(job.run()).rejects.toThrow("system 9 is not registered");
  });
});

describe("meterSigner", () => {
  it("signs with the meter's ML-DSA-87 key, so the reading verifies", () => {
    const kp = generatePqcKeypair(new Uint8Array(32).fill(9));
    const meter = getAddress("0x00000000000000000000000000000000000000a1");
    const msg = attestMessage(9800, meter, 1, 20_400, 1234);
    const sig = meterSigner(new Map([[meter, kp.secretKey]]))(meter.toLowerCase() as Address, msg);
    expect(pqcVerify(kp.publicKey, msg, hexToBytes(sig))).toBe(true);
  });

  it("refuses an account it has no key for and names only the account", () => {
    const sign = meterSigner(new Map());
    expect(() => sign("0x00000000000000000000000000000000000000b2", new Uint8Array([1]))).toThrow(
      `no meter key for ${getAddress("0x00000000000000000000000000000000000000b2")}`,
    );
  });
});

describe("liveMeterJob", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  function folder(content?: string): string {
    const d = mkdtempSync(join(tmpdir(), "mentari-live-"));
    dirs.push(d);
    if (content !== undefined) writeFileSync(join(d, METER_KEYS_FILE), content);
    return d;
  }
  const at = "0x00000000000000000000000000000000000000c3";
  const opts = (mentari: string, keysDir: string | undefined, log?: (l: string) => void) => ({
    cfg: CFG,
    chain: { evmRpc: "https://evm.example.test/", evmChainId: 9800, mentari },
    keysDir,
    windowDays: 1,
    log,
  });
  const keyFile = JSON.stringify({
    sender: `0x${"1f".repeat(32)}`,
    meters: [{ address: at, pqcSecretKey: `0x${"ab".repeat(4896)}` }],
  });

  it("stays off until the contract address and the key file both exist", () => {
    expect(liveMeterJob(opts("", folder(keyFile))).ready()).toBe(false);
    expect(liveMeterJob(opts(at, undefined)).ready()).toBe(false);
    expect(liveMeterJob(opts(at, folder())).ready()).toBe(false);
    expect(liveMeterJob(opts(at, folder(keyFile))).ready()).toBe(true);
  });

  it("logs a broken key file once without its contents and stays off", () => {
    const lines: string[] = [];
    const job = liveMeterJob(opts(at, folder(keyFile.replace('"sender":"0x', '"sender":"')), (l) => lines.push(l)));
    expect(job.ready()).toBe(false);
    expect(lines).toEqual([`daily meter keys: ${METER_KEYS_FILE} sender: expected a 32-byte hex key`]);
  });
});
