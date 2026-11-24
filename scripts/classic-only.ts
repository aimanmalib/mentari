/**
 * classic-only: case I. Can an account's secp256k1 key alone spend its certificates? Records the answer in
 * evidence/testnet.json as case I.
 *
 *   pnpm classic-only     send step 1 (EVM, secp256k1 only) and step 2 (Native, hybrid) once, and write case I
 *
 * The sender (config/app.json `classicOnly.role`) must have no live EVM window; the run stops before sending if it
 * has one. When it holds fewer certificates than one retirement, the demo sender gives it some first, from the
 * Native lane. Output is public data only: roles, addresses, amounts, transaction hashes and the chain's answer.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, getAddress, keccak256, type Address, type Hex } from "viem";
import { accountsPath, readAccountsFile } from "./src/accounts.js";
import { bookReader } from "./src/book.js";
import { loadArtifact } from "./src/chain.js";
import { classicAttempt, nodeMessage, type ClassicOnlyConfig, type ClassicOnlyEntry, type Holdings } from "./src/classic-only.js";
import { loadAppConfig, type AppConfig } from "./src/config.js";
import { writeEvidence } from "./src/evidence.js";
import { feeForGas, type NativeSettings } from "./src/native.js";
import { crossVmCallMsg, runStep, type StepSpec } from "./src/native-entry.js";
import { describeRevert } from "./src/revert.js";
import { evmClients } from "./src/rpc.js";
import { nativeSession } from "./src/session.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE = join(repoRoot, "evidence", "testnet.json");
const STOCK_FROM = "demo sender";
const TITLE = "A classical key alone cannot spend certificates: an EVM retire signed with secp256k1 only, then the same retire from the Native lane";

type App = AppConfig &
  NativeSettings & {
    contracts: { mentari: string };
    native: { receiptsBook: string };
    nativeRoute: { grantGas: number };
    classicOnly: ClassicOnlyConfig;
  };

async function main(): Promise<void> {
  const app = loadAppConfig() as App;
  const cfg = app.classicOnly;
  const prev = existsSync(EVIDENCE) ? (JSON.parse(readFileSync(EVIDENCE, "utf8")) as { cases?: { id: string }[] }) : {};
  if ((prev.cases ?? []).some((c) => c.id === "I")) return console.log("case I is recorded; remove it from evidence/testnet.json to run again");

  const { mnemonic } = readAccountsFile(accountsPath(process.env, repoRoot));
  const session = await nativeSession(app, mnemonic, [cfg.role, STOCK_FROM]);
  const actor = session.byRole(cfg.role);
  const senderKey = session.accounts[cfg.role]!.privateKey as Hex;
  const { pub, wallet } = evmClients(app.network.evmRpc, app.network.evmChainId, senderKey);
  const senderEvm = getAddress(wallet.account.address) as Address;
  const mentari = { address: getAddress(app.contracts.mentari), abi: loadArtifact("Mentari").abi };
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ ...mentari, functionName, args } as never) as Promise<T>;
  const book = bookReader({ rest: app.network.rest, book: app.native.receiptsBook });
  const windowLive = async () => (await session.ctx.lane.window(actor.cosmos)).live;
  const account = (a: string) => session.ctx.lane.account(a);

  if (await windowLive()) throw new Error(`${cfg.role} has a live EVM window; case I needs it closed`);
  if ((await read<bigint>("balanceOf", [senderEvm])) < BigInt(cfg.retireWh)) {
    const stock = session.byRole(STOCK_FROM);
    const acct = await account(stock.cosmos);
    if (!acct) throw new Error(`${STOCK_FROM} has no funds`);
    const msg = crossVmCallMsg(stock.cosmos, mentari.address, mentari.abi, "transfer", [senderEvm, BigInt(cfg.stockWh)]);
    const fee = feeForGas(app.nativeLane, BigInt(app.nativeRoute.grantGas));
    const r = await session.submitter.submit(stock.sign({ messages: [msg], fee, ...acct, classical: false }));
    if (r.stage !== "block" || r.code !== 0) throw new Error(`stock transfer ${r.hash} failed: code ${r.code} ${r.log}`);
    console.log(`${STOCK_FROM} -> ${cfg.role}: ${cfg.stockWh} Wh of certificates (Native lane): ${r.hash}`);
  }

  const args = [BigInt(cfg.retireWh), cfg.memo] as const;
  const holdings = async (): Promise<Holdings> => ({
    nonce: await pub.getTransactionCount({ address: senderEvm, blockTag: "pending" }),
    certificates: String(await read<bigint>("balanceOf", [senderEvm])),
    retirementsCount: String(await read<bigint>("retirementsCount")),
  });
  const ethCall = async () => {
    try {
      await pub.simulateContract({ ...mentari, functionName: "retire", args, account: senderEvm } as never);
      return "the same call succeeds as an eth_call";
    } catch (err) {
      return describeRevert(err) ?? nodeMessage(err);
    }
  };
  const gasPrice = await pub.getGasPrice();
  const classic = await classicAttempt(
    {
      windowLive,
      holdings,
      ethCall,
      signClassic: async (nonce) => {
        const raw = await wallet.signTransaction({
          account: wallet.account,
          chain: wallet.chain,
          type: "legacy",
          to: mentari.address,
          data: encodeFunctionData({ abi: mentari.abi, functionName: "retire", args } as never),
          gas: BigInt(cfg.evmGas),
          gasPrice,
          nonce,
          value: 0n,
        });
        return { raw, hash: keccak256(raw) };
      },
      sendRaw: (raw) => pub.request({ method: "eth_sendRawTransaction", params: [raw] }),
      receipt: async (hash) => {
        try {
          return (await pub.getTransactionReceipt({ hash })).status;
        } catch {
          return null;
        }
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      pollMs: app.nativeLane.pollSeconds * 1000,
    },
    cfg,
  );
  console.log(`step 1 retire, EVM, secp256k1 only: ${classic.refused ? "refused" : "NOT refused"} ${classic.evm_tx}`);
  console.log(`  node: ${classic.rpc_error ?? "took the transaction"}; receipt: ${classic.receipt_status ?? "none"}`);
  console.log(`  eth_call: ${classic.eth_call}`);
  for (const k of ["nonce", "certificates", "retirementsCount"] as const) console.log(`  ${k}: ${classic.before[k]} -> ${classic.after[k]}`);

  const spec: StepSpec = {
    step: 2,
    question: "The same account and the same retire, sent as a hybrid-signed (secp256k1 + ML-DSA-87) MsgCrossVMCall from the Native lane.",
    functionName: "retire",
    args,
    contractWould: "burn the certificates and write one Native receipt",
  };
  const native = await runStep(
    {
      actor,
      submitter: session.submitter,
      account,
      windowLive,
      mentari,
      probe: async () => ({
        retirementsCount: String(await read<bigint>("retirementsCount")),
        [`balanceOf(${cfg.role})`]: String(await read<bigint>("balanceOf", [senderEvm])),
      }),
      receiptsAt: (height) => book.countAt(height),
      revertReason: async () => ethCall(),
      lane: app.nativeLane,
      gas: cfg.nativeGas,
    },
    spec,
  );
  console.log(`step 2 retire, Native, hybrid: ${native.accepted ? "accepted" : "not accepted"} (${native.stage}, code ${native.code} ${native.codespace}) ${native.cosmos_tx}`);
  if (native.receipts) console.log(`  receipts book count: ${native.receipts.before} -> ${native.receipts.after}`);
  for (const s of native.state) console.log(`  ${s.name}: ${s.before} -> ${s.after}`);

  const entry: ClassicOnlyEntry = {
    id: "I",
    title: TITLE,
    sender: { role: cfg.role, cosmos: actor.cosmos, evm: senderEvm },
    ranAt: new Date().toISOString(),
    classic,
    steps: [native],
  };
  writeEvidence(EVIDENCE, { ...prev, cases: [...(prev.cases ?? []), entry] });
  console.log("evidence/testnet.json case I written");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(`classic-only: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
