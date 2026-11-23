/**
 * native-entry: case H, experiment E1. Call Mentari from the Native lane with no EVM window open, and record what the
 * chain answers in evidence/testnet.json as case H.
 *
 *   pnpm native-entry              send the steps not recorded yet (1: attest, 2: retire)
 *   pnpm native-entry --again 1    send step 1 again and replace its record (e.g. once a day without a reading exists)
 *
 * The sender (config/app.json `nativeEntry.role`) must have no live EVM window; the run stops before sending if it
 * has one. Before step 2 the demo sender gives it certificates through its own scoped window when it holds too few.
 * Output is public data only: roles, addresses, amounts, transaction hashes and the chain's answer.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, type Address, type Hex } from "viem";
import { accountsPath, readAccountsFile } from "./src/accounts.js";
import { bookReader } from "./src/book.js";
import { loadArtifact } from "./src/chain.js";
import { loadAppConfig, type AppConfig } from "./src/config.js";
import { writeEvidence } from "./src/evidence.js";
import { attestMessage, loadMeterConfig, signMessage, simulatedWh } from "./src/meter.js";
import type { NativeSettings } from "./src/native.js";
import { entrySteps, mergeSteps, runStep, type NativeEntryConfig, type NativeEntryRecord, type StepSpec } from "./src/native-entry.js";
import { describeRevert } from "./src/revert.js";
import { evmClients } from "./src/rpc.js";
import { nativeSession } from "./src/session.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE = join(repoRoot, "evidence", "testnet.json");
const STOCK_FROM = "demo sender";
const TITLE = "Calls into Mentari sent from the Native lane (MsgCrossVMCall), with no EVM window open";

type App = AppConfig &
  NativeSettings & {
    contracts: { mentari: string };
    native: { receiptsBook: string };
    nativeEntry: NativeEntryConfig;
  };

function againArg(argv: string[]): number | undefined {
  const i = argv.indexOf("--again");
  if (i < 0) return undefined;
  const n = Number(argv[i + 1]);
  if (n !== 1 && n !== 2) throw new Error("usage: pnpm native-entry [--again 1|2]");
  return n;
}

async function main(): Promise<void> {
  const again = againArg(process.argv.slice(2));
  const app = loadAppConfig() as App;
  const cfg = app.nativeEntry;
  const meters = loadMeterConfig();
  const system = meters.systems.find((s) => s.id === cfg.system);
  if (!system) throw new Error(`config/meter.json has no system ${cfg.system}`);
  const meterRole = `meter ${system.label}`;
  const { mnemonic } = readAccountsFile(accountsPath(process.env, repoRoot));
  const session = await nativeSession(app, mnemonic, [cfg.role, STOCK_FROM, meterRole]);
  const sender = session.accounts[cfg.role]!;
  const senderEvm = getAddress(sender.evm) as Address;
  const stock = evmClients(app.network.evmRpc, app.network.evmChainId, session.accounts[STOCK_FROM]!.privateKey as Hex);
  const { pub } = stock;
  const mentari = { address: getAddress(app.contracts.mentari), abi: loadArtifact("Mentari").abi };
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ ...mentari, functionName, args } as never) as Promise<T>;
  const book = bookReader({ rest: app.network.rest, book: app.native.receiptsBook });

  const today = Number(await read<number>("currentDay"));
  const { firstDay } = await read<{ firstDay: number }>("system", [system.id]);
  let freeDay: number | null = null;
  for (let d = today - 1; d >= firstDay && freeDay === null; d--) if (!(await read<boolean>("attested", [system.id, d]))) freeDay = d;
  const steps = entrySteps({
    cfg,
    freeDay,
    firstDay: Number(firstDay),
    whFor: (day) => simulatedWh(meters, system, day),
    sign: (day, wh) =>
      signMessage(session.accounts[meterRole]!.pqc.secretKey, attestMessage(app.network.evmChainId, mentari.address, system.id, day, wh)),
  });

  const prev = existsSync(EVIDENCE) ? (JSON.parse(readFileSync(EVIDENCE, "utf8")) as { cases?: { id: string }[] }) : {};
  const others = (prev.cases ?? []).filter((c) => c.id !== "H");
  const prevEntry = (prev.cases ?? []).find((c) => c.id === "H") as NativeEntryRecord | undefined;
  const done = new Set((prevEntry?.steps ?? []).map((s) => s.step));
  const todo = steps.filter((s) => s.step === again || (again === undefined && !done.has(s.step)));
  if (todo.length === 0) return console.log("case H: every step is recorded; --again 1|2 sends one again");

  if (todo.some((s) => s.functionName === "retire")) {
    const held = await read<bigint>("balanceOf", [senderEvm]);
    if (held < BigInt(cfg.retireWh)) {
      const { request } = await pub.simulateContract({
        ...mentari,
        functionName: "transfer",
        args: [senderEvm, BigInt(cfg.stockWh)],
        account: stock.wallet.account,
      });
      const tx = await stock.wallet.writeContract(request);
      if ((await pub.waitForTransactionReceipt({ hash: tx })).status !== "success") throw new Error(`stock transfer ${tx} reverted`);
      console.log(`${STOCK_FROM} -> ${cfg.role}: ${cfg.stockWh} Wh of certificates (EVM, its own window): ${tx}`);
    }
  }

  const probe = async (spec: StepSpec): Promise<Record<string, string>> => {
    if (spec.functionName === "attest") {
      const [id, day] = spec.args as [number, number];
      const [minted] = await read<readonly [bigint, bigint, bigint]>("totals");
      return { [`attested(${id}, ${day})`]: String(await read<boolean>("attested", [id, day])), minted: String(minted) };
    }
    return {
      retirementsCount: String(await read<bigint>("retirementsCount")),
      [`balanceOf(${cfg.role})`]: String(await read<bigint>("balanceOf", [senderEvm])),
    };
  };
  const actor = session.byRole(cfg.role);
  const records = [];
  for (const spec of todo) {
    const r = await runStep(
      {
        actor,
        submitter: session.submitter,
        account: (a) => session.ctx.lane.account(a),
        windowLive: async () => (await session.ctx.lane.window(actor.cosmos)).live,
        mentari,
        probe,
        receiptsAt: (height) => book.countAt(height),
        revertReason: async (spec) => {
          try {
            await pub.simulateContract({ ...mentari, functionName: spec.functionName, args: spec.args, account: senderEvm } as never);
            return "the same call succeeds as an eth_call";
          } catch (err) {
            return describeRevert(err) ?? (err instanceof Error ? err.message.split("\n")[0]! : String(err));
          }
        },
        lane: app.nativeLane,
        gas: cfg.gas,
      },
      spec,
    );
    console.log(`step ${r.step} ${r.function}: ${r.accepted ? "accepted" : "not accepted"} (${r.stage}, code ${r.code} ${r.codespace}) ${r.cosmos_tx}`);
    if (!r.accepted) console.log(`  ${r.log}`);
    if (r.receipts) console.log(`  receipts book count: ${r.receipts.before} -> ${r.receipts.after}`);
    if (r.revert_reason) console.log(`  eth_call says: ${r.revert_reason}`);
    for (const s of r.state) console.log(`  ${s.name}: ${s.before} -> ${s.after}`);
    records.push(r);
  }

  const entry: NativeEntryRecord = {
    id: "H",
    title: TITLE,
    sender: { role: cfg.role, cosmos: actor.cosmos, evm: senderEvm },
    ranAt: new Date().toISOString(),
    steps: mergeSteps(prevEntry?.steps, records),
  };
  writeEvidence(EVIDENCE, { ...prev, cases: [...others, entry] });
  console.log("evidence/testnet.json case H written");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(`native-entry: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
