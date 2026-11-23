/**
 * cases: record the testnet cases A to G in evidence/testnet.json.
 *
 *   pnpm cases            send each case the evidence does not hold yet, then write the file
 *
 * Before the cases, the demo sender gets certificates from the producer when it holds fewer than
 * `cases.stockMinWh` (through the producer's scoped window `stock`, closed again after), and its own scoped window
 * `demo` is opened when the live one is missing or too small. That window stays open for the site's demo.
 * E and F need a finished UTC day without a reading; while there is none they are left for a later run.
 * Output is public data only: roles, addresses, amounts and transaction hashes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { evmToQor } from "@qorechain/sdk";
import { getAddress, type Address, type Hex } from "viem";
import { accountsPath, readAccountsFile } from "./src/accounts.js";
import { bookReader } from "./src/book.js";
import {
  attestCases,
  CASE_ORDER,
  fixedCases,
  mergeEvidence,
  pendingCases,
  REVERT_REASON_FROM,
  runCase,
  type CaseRecord,
  type CasesConfig,
  type CasesEnv,
} from "./src/cases.js";
import { loadArtifact } from "./src/chain.js";
import { loadAppConfig, type AppConfig } from "./src/config.js";
import { writeEvidence } from "./src/evidence.js";
import { loadMeterConfig, signMessage } from "./src/meter.js";
import { closeWindow, openWindow, type NativeSettings } from "./src/native.js";
import { evmClients } from "./src/rpc.js";
import { nativeSession } from "./src/session.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE = join(repoRoot, "evidence", "testnet.json");
const SENDER = "demo sender";
const PRODUCER = "producer";

type App = AppConfig &
  NativeSettings & {
    contracts: { mentari: string; atomicityProbe: string };
    native: { receiptsBook: string; notAllowlistedTarget: string };
    cases: Omit<CasesConfig, "notAllowlistedTarget" | "revertGas"> & { stockWh: number; stockMinWh: number; windowNeedQor: string };
  };

async function main(): Promise<void> {
  const app = loadAppConfig() as App;
  const limits = JSON.parse(readFileSync(join(repoRoot, "config", "limits.json"), "utf8")) as {
    demo: { revertCaseGas: number };
  };
  const cfg: CasesConfig = {
    ...app.cases,
    notAllowlistedTarget: app.native.notAllowlistedTarget,
    revertGas: limits.demo.revertCaseGas,
  };
  if (!cfg.notAllowlistedTarget) throw new Error("config/app.json native.notAllowlistedTarget is empty");
  const meters = loadMeterConfig();
  const { mnemonic } = readAccountsFile(accountsPath(process.env, repoRoot));
  const signerRoles = [cfg.wrongKeyRole, ...meters.systems.map((s) => `meter ${s.label}`)];
  const session = await nativeSession(app, mnemonic, [...new Set([SENDER, PRODUCER, ...signerRoles])]);
  const evm = (role: string) =>
    evmClients(app.network.evmRpc, app.network.evmChainId, session.accounts[role]!.privateKey as Hex);
  const sign = (role: string, message: Uint8Array): Hex => {
    const account = session.accounts[role];
    if (!account) throw new Error(`no ML-DSA-87 key for role "${role}"`);
    return signMessage(account.pqc.secretKey, message);
  };

  const mentari = { address: getAddress(app.contracts.mentari), abi: loadArtifact("Mentari").abi };
  const probe = { address: getAddress(app.contracts.atomicityProbe), abi: loadArtifact("AtomicityProbe").abi };
  const { pub, wallet } = evm(SENDER);
  const env: CasesEnv = {
    pub,
    wallet,
    mentari,
    probe,
    book: bookReader({ rest: app.network.rest, book: app.native.receiptsBook }),
    mentariNative: evmToQor(mentari.address),
    log: (line) => console.log(line),
  };

  const balanceOf = async (who: Address) =>
    (await pub.readContract({ ...mentari, functionName: "balanceOf", args: [who] })) as bigint;
  if ((await balanceOf(wallet.account.address)) < BigInt(app.cases.stockMinWh)) {
    const producer = evm(PRODUCER);
    await openWindow(session.ctx, session.byRole(PRODUCER), "stock");
    const { request } = await pub.simulateContract({
      ...mentari,
      functionName: "transfer",
      args: [wallet.account.address, BigInt(app.cases.stockWh)],
      account: producer.wallet.account,
    });
    const tx = await producer.wallet.writeContract(request);
    const r = await pub.waitForTransactionReceipt({ hash: tx });
    if (r.status !== "success") throw new Error(`stock transfer ${tx} reverted`);
    console.log(`producer -> ${SENDER}: ${app.cases.stockWh} Wh of certificates: ${tx}`);
    await closeWindow(session.ctx, session.byRole(PRODUCER));
  }

  const prev = existsSync(EVIDENCE) ? (JSON.parse(readFileSync(EVIDENCE, "utf8")) as { cases?: CaseRecord[] }) : undefined;
  const todo = pendingCases([...fixedCases(cfg), ...(await attestCases(env, cfg, meters, sign))], prev?.cases ?? []);
  const head = {
    chainId: app.network.chainId,
    evmChainId: app.network.evmChainId,
    evmRpc: app.network.evmRpc,
    rest: app.network.rest,
    contracts: {
      mentari: mentari.address,
      mentariNative: env.mentariNative,
      atomicityProbe: probe.address,
      receiptsBook: app.native.receiptsBook,
      notAllowlistedTarget: cfg.notAllowlistedTarget,
    },
    sender: { role: SENDER, evm: wallet.account.address },
    revertReasonFrom: REVERT_REASON_FROM,
  };
  if (todo.length > 0) {
    await openWindow(session.ctx, session.byRole(SENDER), "demo", { txs: todo.length, valueQor: app.cases.windowNeedQor });
  }
  let evidence = mergeEvidence(prev, head, []);
  for (const spec of todo) {
    const record = await runCase(env, spec, cfg.revertGas);
    evidence = mergeEvidence(evidence, head, [record]);
    writeEvidence(EVIDENCE, evidence);
  }
  const missing = CASE_ORDER.filter((id) => !evidence.cases.some((c) => c.id === id));
  console.log(`evidence/testnet.json holds ${evidence.cases.length} cases${missing.length ? `; still to run: ${missing.join(", ")}` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(`cases: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
