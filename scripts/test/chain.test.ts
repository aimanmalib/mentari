import type { Address, PublicClient } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attestDays,
  chainDay,
  deploy,
  loadArtifact,
  readSystem,
  registerSystems,
  revertName,
  type MeterRun,
  type SystemPlan,
} from "../src/chain.js";
import { simulatedWh, type MeterConfig } from "../src/meter.js";
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
    { id: 3, label: "C", capacityW: 12000 },
  ],
};
const BOOK = "qor1fixturebook";

const mentariArt = loadArtifact("Mentari");
let chain: LocalChain;
let registrar: Address, producer: Address, sender: Address, outsider: Address;
let plans: SystemPlan[];

beforeAll(async () => {
  chain = await startAnvil();
  const [, reg, mA, mB, mC, prod, send, out] = chain.accounts as Address[];
  [registrar, producer, sender, outsider] = [reg!, prod!, send!, out!];
  for (const a of [registrar, mA!, mB!, mC!, producer]) await chain.makeQuantumReady(a);
  const meters = [mA!, mB!, mC!];
  plans = CFG.systems.map((s, i) => ({ ...s, meter: meters[i]!, producer }));
}, 60_000);
afterAll(() => chain?.stop());

async function freshRun(over: Partial<MeterRun> = {}): Promise<MeterRun> {
  const wallet = chain.wallet(sender);
  const d = await deploy(chain.pub, wallet, mentariArt, [registrar, BOOK, CFG.maxSunHoursX10]);
  return { pub: chain.pub, wallet, mentari: d.address, abi: mentariArt.abi, sign: chain.sign, ...over };
}

const read = (run: MeterRun, functionName: string, args: readonly unknown[] = []) =>
  run.pub.readContract({ address: run.mentari, abi: run.abi, functionName, args });

describe("deploy", () => {
  it("puts both contracts on chain with the constructor values", async () => {
    const wallet = chain.wallet(sender);
    const m = await deploy(chain.pub, wallet, mentariArt, [registrar, BOOK, 80]);
    const p = await deploy(chain.pub, wallet, loadArtifact("AtomicityProbe"), [BOOK]);
    expect(m.address).not.toBe(p.address);
    expect(m.block).toBeGreaterThan(0n);
    const run = { pub: chain.pub, mentari: m.address, abi: mentariArt.abi } as MeterRun;
    expect(await read(run, "registrar")).toBe(registrar);
    expect(await read(run, "maxSunHoursX10")).toBe(80);
    expect(await read(run, "receiptsBook")).toBe(BOOK);
  });

  it("names the missing build output", () => {
    expect(() => loadArtifact("Mentari", "/nonexistent")).toThrow(/forge build/);
  });
});

describe("register and backfill", () => {
  it("registers three systems once, then attests the window once", async () => {
    const run = await freshRun();
    const today = await chainDay(chain.pub);
    const firstDay = today - CFG.backfillDays;

    const reg = await registerSystems(run, registrar, plans, firstDay);
    expect(reg.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(await read(run, "nonce")).toBe(3n);
    expect(await registerSystems(run, registrar, plans, firstDay)).toEqual([]);
    expect(await readSystem(run, 2)).toMatchObject({ capacityW: 8200, firstDay, producer });

    // A daily run first (yesterday only), then the backfill fills the two days before it.
    const daily = await attestDays(run, CFG, plans, 1);
    expect(daily.map((s) => [s.id, s.day])).toEqual([
      [1, today - 1],
      [2, today - 1],
      [3, today - 1],
    ]);
    const backfill = await attestDays(run, CFG, plans);
    expect(backfill.map((s) => s.day)).toEqual([today - 3, today - 2, today - 3, today - 2, today - 3, today - 2]);
    expect(await attestDays(run, CFG, plans)).toEqual([]);

    let expected = 0n;
    for (const s of plans) for (let d = firstDay; d < today; d++) expected += BigInt(simulatedWh(CFG, s, d));
    for (const s of [...daily, ...backfill]) expect(s.wh).toBe(simulatedWh(CFG, plans[s.id - 1]!, s.day));
    expect(await read(run, "totals")).toEqual([expected, 0n, expected]);
    expect(await read(run, "balanceOf", [producer])).toBe(expected);
  }, 60_000);

  it("logs public data only, one line per transaction", async () => {
    const lines: string[] = [];
    const run = await freshRun({ log: (l) => lines.push(l) });
    await registerSystems(run, registrar, plans.slice(0, 1), (await chainDay(chain.pub)) - 1);
    await attestDays(run, CFG, plans.slice(0, 1));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^register system 1 \(A\) first day \d+: 0x[0-9a-f]{64}$/);
    expect(lines[1]).toMatch(/^attest system 1 \(A\) day \d+ \d+ Wh: 0x[0-9a-f]{64}$/);
  }, 60_000);
});

describe("refusals cost nothing", () => {
  it("a bad signature fails with the contract's error and nothing is registered", async () => {
    const run = await freshRun({ sign: (a, m) => chain.sign(outsider, m) });
    const err = await registerSystems(run, registrar, plans, 20_000).catch((e: unknown) => e);
    expect(revertName(err)).toBe("BadSignature");
    expect(await read(run, "nonce")).toBe(0n);
  });

  it("a producer without a key fails with NotQuantumReady", async () => {
    const run = await freshRun();
    const bad = [{ ...plans[0]!, producer: outsider }];
    const err = await registerSystems(run, registrar, bad, 20_000).catch((e: unknown) => e);
    expect(revertName(err)).toBe("NotQuantumReady");
  });

  it("refuses to sign when its bytes differ from the contract's", async () => {
    const pub = new Proxy(chain.pub, {
      get: (t, k) => (k === "getChainId" ? async () => 9801 : Reflect.get(t, k)),
    }) as PublicClient;
    const run = await freshRun({ pub });
    let signed = 0;
    run.sign = (a, m) => (signed++, chain.sign(a, m));
    await expect(registerSystems(run, registrar, plans, 20_000)).rejects.toThrow(/differ from the contract's/);
    expect(signed).toBe(0);
    expect(await read(run, "nonce")).toBe(0n);
  });

  it("stops when the chain holds a system with another capacity", async () => {
    const run = await freshRun();
    await registerSystems(run, registrar, plans.slice(0, 1), 20_000);
    const changed = [{ ...plans[0]!, capacityW: 6000 }];
    await expect(registerSystems(run, registrar, changed, 20_000)).rejects.toThrow(/other accounts or capacity/);
    await expect(attestDays(run, CFG, changed)).rejects.toThrow(/other accounts or capacity/);
  });

  it("treats only UnknownSystem as not registered, not any failed read", async () => {
    const noContract = { pub: chain.pub, mentari: outsider, abi: mentariArt.abi };
    await expect(readSystem(noContract, 1)).rejects.toThrow();
  });

  it("will not attest a system that is not registered", async () => {
    const run = await freshRun();
    await expect(attestDays(run, CFG, plans)).rejects.toThrow(/system 1 is not registered/);
  });
});
