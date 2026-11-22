import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { attestDays, chainDay, deploy, loadArtifact, registerSystems, type SystemPlan } from "../../scripts/src/chain.js";
import { startAnvil, type LocalChain } from "../../scripts/test/lib/anvil.js";
import { asExpected } from "../src/demo/api.js";
import { unconfiguredChain, type DemoAction, type DemoChain } from "../src/demo/chain.js";
import { DEMO_KEY_FILE } from "../src/demo/keys.js";
import { chainDemo, liveDemoChain, restReceiptsCount, type DemoSendConfig } from "../src/demo/live.js";
import { evmClients } from "../src/evm.js";
import { meterModel, testConfig } from "./fixture.js";

// Each test sends real transactions to a local node; shared CI machines can be slow.
vi.setConfig({ testTimeout: 60_000 });

const BRIDGE: Address = "0x0000000000000000000000000000000000000901";
const BOOK = "qor1fixturebook";
const SEND: DemoSendConfig = {
  retireMemo: "fixture memo",
  probeNote: "fixture note",
  revertCaseGas: 3_000_000,
  caseDTarget: "qor1notallowlisted",
};
const bridgeArt = loadArtifact("MockCrossVmBridge");
let chain: LocalChain;
let demoAccount: Address, visitor: Address, stranger: Address;
let mentari: Address, probe: Address;

const receipts = async () =>
  Number(await chain.pub.readContract({ address: BRIDGE, abi: bridgeArt.abi, functionName: "count" }));
/** anvil's public development mnemonic. Its keys hold nothing outside a local node. */
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
/**
 * The demo signing locally with the account's key, as the server does, so viem estimates gas before each send
 * the way it will on the testnet (an unlocked anvil account would let the node fill in the gas instead).
 */
const demoFor = (account: Address, send: DemoSendConfig = SEND): DemoChain => {
  const index = chain.accounts.indexOf(account);
  const key = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).getHdKey().privateKey!;
  const { wallet } = evmClients(chain.rpcUrl, 9800, `0x${Buffer.from(key).toString("hex")}`);
  return chainDemo({ pub: chain.pub, wallet, mentari, probe, receipts, send });
};
const nonce = (a: Address) => chain.pub.getTransactionCount({ address: a });

beforeAll(async () => {
  chain = await startAnvil();
  const [deployer, registrar, meter, demo, vis, str] = chain.accounts as Address[];
  [demoAccount, visitor, stranger] = [demo!, vis!, str!];
  for (const a of [registrar!, meter!, demoAccount, visitor]) await chain.makeQuantumReady(a);

  // The bridge stand-in with the receipts book on its allowlist.
  await chain.etch(BRIDGE, "MockCrossVmBridge");
  const w = chain.wallet(deployer!);
  const allow = await w.writeContract({ address: BRIDGE, abi: bridgeArt.abi, functionName: "allow", args: [BOOK], account: w.account, chain: w.chain });
  await chain.pub.waitForTransactionReceipt({ hash: allow });

  const cfg = meterModel();
  mentari = (await deploy(chain.pub, w, loadArtifact("Mentari"), [registrar, BOOK, cfg.maxSunHoursX10])).address;
  probe = (await deploy(chain.pub, w, loadArtifact("AtomicityProbe"), [BOOK])).address;
  // One system whose producer is the demo account, so its readings pay the demo account in certificates.
  const plans: SystemPlan[] = [{ ...cfg.systems[0]!, meter: meter!, producer: demoAccount }];
  const run = { pub: chain.pub, wallet: w, mentari, abi: loadArtifact("Mentari").abi, sign: chain.sign };
  await registerSystems(run, registrar!, plans, (await chainDay(chain.pub)) - cfg.backfillDays);
  await attestDays(run, cfg, plans, cfg.backfillDays);
}, 120_000);
afterAll(() => chain?.stop());

describe("chainDemo", () => {
  it("retires: both ledgers gain one, as case A expects", async () => {
    const demo = demoFor(demoAccount);
    const before = await demo.counts();
    const sent = await demo.send("retire", { retireWh: 500 });
    const after = await demo.counts();
    expect(sent.status).toBe("success");
    expect(sent.evmTx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(after).toEqual({ receipts: before.receipts + 1, retirements: before.retirements + 1 });
  });

  it.each<[DemoAction, string]>([
    ["case-b", "records a receipt, then reverts"],
    ["case-c", "asks the book for something it refuses"],
    ["case-d", "calls a Native contract that is not allowlisted"],
  ])("%s %s: mined as reverted, neither ledger moves", async (action) => {
    const demo = demoFor(demoAccount);
    const before = await demo.counts();
    const sent = await demo.send(action, { retireWh: 500 });
    const after = await demo.counts();
    expect(sent.status).toBe("reverted");
    expect(await chain.pub.getTransactionReceipt({ hash: sent.evmTx as `0x${string}` })).toMatchObject({ status: "reverted" });
    expect(asExpected({ expect: "revert" }, sent, before, after)).toBe(true);
  });

  it("sends nothing for case D while no target is configured", async () => {
    const n = await nonce(demoAccount);
    await expect(demoFor(demoAccount, { ...SEND, caseDTarget: "" }).send("case-d", { retireWh: 500 })).rejects.toThrow(/no target/);
    expect(await nonce(demoAccount)).toBe(n);
  });

  it("sends nothing when the demo account holds fewer certificates than one retirement", async () => {
    const n = await nonce(stranger);
    await expect(demoFor(stranger).send("retire", { retireWh: 500 })).rejects.toThrow(/holds 0 Wh of certificates, needs 500/);
    await expect(demoFor(stranger).grant(visitor, 500)).rejects.toThrow(/holds 0 Wh/);
    expect(await nonce(stranger)).toBe(n);
  });

  it("grants certificates to a quantum-ready wallet and reads readiness from the contract", async () => {
    const demo = demoFor(demoAccount);
    expect(await demo.isQuantumReady(visitor)).toBe(true);
    expect(await demo.isQuantumReady(stranger.toLowerCase())).toBe(false);
    const sent = await demo.grant(visitor.toLowerCase(), 500);
    expect(sent.status).toBe("success");
    const balance = await chain.pub.readContract({ address: mentari, abi: loadArtifact("Mentari").abi, functionName: "balanceOf", args: [visitor] });
    expect(balance).toBe(500n);
  });

  it("reports the sender's QOR balance in whole units", async () => {
    const qor = await demoFor(demoAccount).senderBalanceQor();
    expect(qor).toBeGreaterThan(9000);
    expect(qor).toBeLessThanOrEqual(10000);
  });
});

describe("liveDemoChain", () => {
  const dirs: string[] = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const folder = (content?: string) => {
    const d = mkdtempSync(join(tmpdir(), "mentari-demo-live-"));
    dirs.push(d);
    if (content !== undefined) writeFileSync(join(d, DEMO_KEY_FILE), content);
    return d;
  };
  const KEY = `0x${"3d".repeat(32)}`;
  const deployed = { ...testConfig().demoChain, mentari: "0x00000000000000000000000000000000000000c3", atomicityProbe: "0x00000000000000000000000000000000000000d4" };

  it("stays on the recorded cases until both contracts and the key file exist", () => {
    const keys = folder(JSON.stringify({ privateKey: KEY }));
    expect(liveDemoChain({ chain: testConfig().demoChain, keysDir: keys })).toBe(unconfiguredChain);
    expect(liveDemoChain({ chain: { ...deployed, atomicityProbe: "" }, keysDir: keys })).toBe(unconfiguredChain);
    expect(liveDemoChain({ chain: deployed, keysDir: folder() })).toBe(unconfiguredChain);
    expect(liveDemoChain({ chain: deployed, keysDir: undefined })).toBe(unconfiguredChain);
    expect(liveDemoChain({ chain: deployed, keysDir: keys }).ready()).toBe(true);
  });

  it("logs a broken key file once without its contents and stays on the recorded cases", () => {
    const lines: string[] = [];
    const demo = liveDemoChain({ chain: deployed, keysDir: folder(JSON.stringify({ privateKey: "0x3d3d" })), log: (l) => lines.push(l) });
    expect(demo).toBe(unconfiguredChain);
    expect(lines).toEqual([`demo sender key: ${DEMO_KEY_FILE} privateKey: expected a 32-byte hex key`]);
  });
});

describe("restReceiptsCount", () => {
  const answer = (status: number, body: unknown) => async () => ({ status, json: async () => body });

  it("asks the book's count query over public REST", async () => {
    const urls: string[] = [];
    const count = restReceiptsCount({
      rest: "https://rest.example.test/",
      book: "qor1book",
      timeoutMs: 1000,
      fetch: async (url) => (urls.push(url), { status: 200, json: async () => ({ data: { count: 42 } }) }),
    });
    expect(await count()).toBe(42);
    const query = Buffer.from(JSON.stringify({ count: {} })).toString("base64");
    expect(urls).toEqual([`https://rest.example.test/cosmwasm/wasm/v1/contract/qor1book/smart/${encodeURIComponent(query)}`]);
  });

  it.each([
    ["an error status", answer(500, { message: "boom" })],
    ["no count", answer(200, { data: {} })],
    ["a count that is not a number", answer(200, { data: { count: "42" } })],
    ["a body that is not JSON", async () => ({ status: 502, json: () => Promise.reject(new Error("html")) })],
  ])("fails on %s", async (_name, fetch) => {
    const count = restReceiptsCount({ rest: "https://rest.example.test", book: "qor1book", timeoutMs: 1000, fetch });
    await expect(count()).rejects.toThrow(/receipts count unreadable/);
  });
});
