import { getAddress, type Abi, type Address, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BookReader } from "../src/book.js";
import {
  attestCases,
  fixedCases,
  mergeEvidence,
  pendingCases,
  runCase,
  type CaseRecord,
  type CasesConfig,
  type CasesEnv,
} from "../src/cases.js";
import { chainDay, deploy, loadArtifact, registerSystems, type SystemPlan } from "../src/chain.js";
import { attestMessage, simulatedWh, type MeterConfig } from "../src/meter.js";
import { startAnvil, type LocalChain } from "./lib/anvil.js";

/** Frozen fixtures, so a change to config/app.json or config/meter.json never turns these tests red. */
const METERS: MeterConfig = {
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
const OTHER_BOOK = "qor1fixtureotherbook";
const BRIDGE: Address = "0x0000000000000000000000000000000000000901";
const CFG: CasesConfig = {
  retireWh: 500,
  memo: "Testnet case A",
  probeNote: "Testnet case",
  system: 1,
  wrongKeyRole: "meter B",
  unkeyedRecipient: "0x000000000000000000000000000000000000dEaD",
  transferWh: 1,
  notAllowlistedTarget: OTHER_BOOK,
  revertGas: 3_000_000,
};

vi.setConfig({ testTimeout: 60_000 });

let chain: LocalChain;
let env: CasesEnv;
let roles: Record<string, Address>;
const bridgeAbi = loadArtifact("MockCrossVmBridge").abi;

beforeAll(async () => {
  chain = await startAnvil();
  const [, registrar, meterA, meterB, producer, sender] = chain.accounts as Address[];
  roles = { registrar: registrar!, "meter A": meterA!, "meter B": meterB!, producer: producer!, sender: sender! };
  for (const a of Object.values(roles)) await chain.makeQuantumReady(a);
  await chain.etch(BRIDGE, "MockCrossVmBridge");
  await send(chain.accounts[0]!, BRIDGE, bridgeAbi, "allow", [BOOK]);

  const deployer = chain.wallet(chain.accounts[0]!);
  const mentariArt = loadArtifact("Mentari");
  const probeArt = loadArtifact("AtomicityProbe");
  const m = await deploy(chain.pub, deployer, mentariArt, [registrar, BOOK, METERS.maxSunHoursX10]);
  const p = await deploy(chain.pub, deployer, probeArt, [BOOK]);
  const run = { pub: chain.pub, wallet: deployer, mentari: m.address, abi: mentariArt.abi, sign: chain.sign };
  const today = await chainDay(chain.pub);
  const plans: SystemPlan[] = METERS.systems.map((s) => ({ ...s, meter: roles[`meter ${s.label}`]!, producer: producer! }));
  await registerSystems(run, registrar!, plans, today - 3);
  // Only the first day gets a reading, so E2 has a day to repeat and E and F have a free one.
  const wh = simulatedWh(METERS, METERS.systems[0]!, today - 3);
  const sig = chain.sign(meterA!, attestMessage(9800, m.address, 1, today - 3, wh));
  await send(producer!, m.address, mentariArt.abi, "attest", [1, today - 3, BigInt(wh), sig]);
  await send(producer!, m.address, mentariArt.abi, "transfer", [sender!, BigInt(wh)]);

  const readBridge = (functionName: string, args: readonly unknown[], blockNumber?: bigint) =>
    chain.pub.readContract({ address: BRIDGE, abi: bridgeAbi, functionName, args, ...(blockNumber ? { blockNumber } : {}) });
  const book: BookReader = {
    countAt: async (h) => Number(await readBridge("count", [], BigInt(h))),
    receipt: async (id) => {
      const r = (await readBridge("receipt", [BigInt(id)])) as { id: bigint; sender: Address; note: string };
      return { id: Number(r.id), sender: getAddress(r.sender), note: r.note, height: 0 };
    },
    cosmosTxOf: async () => null,
  };
  env = {
    pub: chain.pub,
    wallet: chain.wallet(sender!),
    mentari: { address: m.address, abi: mentariArt.abi },
    probe: { address: p.address, abi: probeArt.abi },
    book,
    mentariNative: getAddress(m.address),
    cosmosLookup: { tries: 1, waitMs: 0 },
  };
}, 120_000);
afterAll(() => chain?.stop());

async function send(from: Address, address: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
  const w = chain.wallet(from);
  const tx = await w.writeContract({ address, abi, functionName, args, account: w.account, chain: w.chain });
  const r = await chain.pub.waitForTransactionReceipt({ hash: tx });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
}

const sign = (role: string, message: Uint8Array): Hex => chain.sign(roles[role]!, message);
const nonce = () => chain.pub.getTransactionCount({ address: env.wallet.account.address });
const byId = (specs: ReturnType<typeof fixedCases>, id: string) => specs.find((s) => s.id === id)!;

describe("fixed cases", () => {
  it("retires with a receipt from the contract, and B, C, D and G revert with both ledgers unchanged", async () => {
    const out: CaseRecord[] = [];
    for (const spec of fixedCases(CFG)) out.push(await runCase(env, spec, CFG.revertGas));
    const [a, b, c, d, g] = out;
    expect(a).toMatchObject({ id: "A", status: "success", receipts: { before: 0, after: 1 }, retirements: { before: 0, after: 1 } });
    expect(a!.receipt).toEqual({
      id: 1,
      sender: env.mentariNative,
      note: `MTR1 n=1 wh=500 by=${env.wallet.account.address.toLowerCase()} m=Testnet case A`,
    });
    for (const r of [b, c, d, g]) {
      expect(r).toMatchObject({ expect: "revert", status: "reverted", receipts: { before: 1, after: 1 } });
      expect(r!.retirements.before).toBe(r!.retirements.after);
      expect(r!.gas_used).toBeLessThan(CFG.revertGas);
      expect(r!.receipt).toBeUndefined();
    }
    expect(b!.revert_reason).toBe("RevertedAfterNativeWrite(2)");
    expect(c!.revert_reason).toBe('BridgeCallFailed("refused on purpose by the Native contract")');
    expect(d!.revert_reason).toBe(`BridgeCallFailed("REFUSED by the bridge: ${OTHER_BOOK} is not allowlisted")`);
    expect(g!.revert_reason).toBe(`NotQuantumReady(${getAddress(CFG.unkeyedRecipient)})`);
    expect(out.map((r) => r.cosmos_tx)).toEqual([null, null, null, null, null]);
  });

  it("sends nothing when a revert case would succeed or fail another way", async () => {
    const before = await nonce();
    const allowed = { ...byId(fixedCases(CFG), "D"), args: [BOOK, CFG.probeNote] };
    await expect(runCase(env, allowed, CFG.revertGas)).rejects.toThrow(/would succeed; not sent/);
    const wrongReason = { ...byId(fixedCases(CFG), "G"), reason: "ZeroAmount" };
    await expect(runCase(env, wrongReason, CFG.revertGas)).rejects.toThrow(/expected ZeroAmount, simulation gave NotQuantumReady/);
    const failingRetire = { ...byId(fixedCases(CFG), "A"), args: [10n ** 12n, CFG.memo] };
    await expect(runCase(env, failingRetire, CFG.revertGas)).rejects.toThrow(/simulation failed \(InsufficientBalance/);
    expect(await nonce()).toBe(before);
  });
});

describe("attest cases", () => {
  it("builds E2 on the attested day and E and F on the free one; each reverts with its own error", async () => {
    const specs = await attestCases(env, CFG, METERS, sign);
    expect(specs.map((s) => s.id)).toEqual(["E2", "E", "F"]);
    const today = await chainDay(chain.pub);
    expect(specs.map((s) => s.args[1])).toEqual([today - 3, today - 1, today - 1]);
    const out = [];
    for (const s of pendingCases(specs, [])) out.push(await runCase(env, s, CFG.revertGas));
    expect(out.map((r) => [r.id, r.status])).toEqual([
      ["E", "reverted"],
      ["E2", "reverted"],
      ["F", "reverted"],
    ]);
    expect(out[0]!.revert_reason).toBe(`BadSignature(${roles["meter A"]})`);
    expect(out[1]!.revert_reason).toBe(`AlreadyAttested(1, ${today - 3})`);
    expect(out[2]!.revert_reason).toBe("WhOutOfRange(40001, 40000)");
  });

  it("leaves E and F out while every finished day has a reading", async () => {
    const today = await chainDay(chain.pub);
    for (const day of [today - 2, today - 1]) {
      const wh = simulatedWh(METERS, METERS.systems[0]!, day);
      const sig = chain.sign(roles["meter A"]!, attestMessage(9800, env.mentari.address, 1, day, wh));
      await send(roles.producer!, env.mentari.address, env.mentari.abi, "attest", [1, day, BigInt(wh), sig]);
    }
    expect((await attestCases(env, CFG, METERS, sign)).map((s) => s.id)).toEqual(["E2"]);
    await expect(attestCases(env, { ...CFG, system: 9 }, METERS, sign)).rejects.toThrow(/cases.system 9/);
  });
});

describe("evidence", () => {
  const rec = (id: CaseRecord["id"], evm_tx: Hex = "0x01") => ({ id, evm_tx }) as CaseRecord;
  const head = {
    chainId: "c",
    evmChainId: 1,
    evmRpc: "r",
    rest: "s",
    contracts: {},
    sender: { role: "demo sender", evm: "0x" },
    revertReasonFrom: "x",
  };

  it("keeps recorded cases, adds new ones in case order, and never replaces one", () => {
    const first = mergeEvidence(undefined, head, [rec("G"), rec("A")]);
    expect(first.cases.map((c) => c.id)).toEqual(["A", "G"]);
    const second = mergeEvidence(first, head, [rec("A", "0x02"), rec("E"), rec("B")]);
    expect(second.cases.map((c) => [c.id, c.evm_tx])).toEqual([
      ["A", "0x01"],
      ["B", "0x01"],
      ["E", "0x01"],
      ["G", "0x01"],
    ]);
  });

  it("lists only the cases still to send", () => {
    const specs = fixedCases(CFG);
    expect(pendingCases(specs, [{ id: "A" }, { id: "D" }]).map((s) => s.id)).toEqual(["B", "C", "G"]);
  });
});
