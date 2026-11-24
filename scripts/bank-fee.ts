/**
 * bank-fee: cases J and J2. A bank transfer and a contract call in one hybrid-signed Native transaction. Records both
 * in evidence/testnet.json.
 *
 *   pnpm bank-fee     send case J (fee + retire, both run) and case J2 (fee + a retire that reverts) once each
 *
 * The sender (config/app.json `bankFee.role`) must have no live EVM window. When it holds fewer certificates than one
 * retirement, the demo sender gives it some first, from the Native lane. Output is public data only: roles,
 * addresses, amounts, transaction hashes and the chain's answer.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, type Address } from "viem";
import { accountsPath, readAccountsFile } from "./src/accounts.js";
import { BANK_FEE_MESSAGES, bankFeeSpecs, bankReader, describeRun, feeMsg, runBankFee, type BankFeeConfig, type BankFeeEntry } from "./src/bank-fee.js";
import { bookReader } from "./src/book.js";
import { loadArtifact } from "./src/chain.js";
import { nodeMessage } from "./src/classic-only.js";
import { loadAppConfig, type AppConfig } from "./src/config.js";
import { writeEvidence } from "./src/evidence.js";
import { feeForGas, type NativeSettings } from "./src/native.js";
import { crossVmCallMsg } from "./src/native-entry.js";
import { describeRevert } from "./src/revert.js";
import { evmClients } from "./src/rpc.js";
import { nativeSession } from "./src/session.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE = join(repoRoot, "evidence", "testnet.json");
const STOCK_FROM = "demo sender";
const TITLES = {
  J: "A bank transfer and a contract call in one hybrid-signed transaction: the retirement fee, the certificates and the Native receipt move in the same block",
  J2: "The same transaction with a retire the contract refuses: the fee transfer that ran first is undone with it",
};

type App = AppConfig &
  NativeSettings & {
    contracts: { mentari: string };
    native: { receiptsBook: string };
    nativeRoute: { grantGas: number };
    bankFee: BankFeeConfig;
  };

async function main(): Promise<void> {
  const app = loadAppConfig() as App;
  const cfg = app.bankFee;
  const prev = existsSync(EVIDENCE) ? (JSON.parse(readFileSync(EVIDENCE, "utf8")) as { cases?: { id: string }[] }) : {};
  if ((prev.cases ?? []).some((c) => c.id === "J" || c.id === "J2"))
    return console.log("case J is recorded; remove J and J2 from evidence/testnet.json to run again");

  const { mnemonic } = readAccountsFile(accountsPath(process.env, repoRoot));
  const session = await nativeSession(app, mnemonic, [cfg.role, cfg.to, STOCK_FROM]);
  const actor = session.byRole(cfg.role);
  const to = session.byRole(cfg.to);
  const { pub, wallet } = evmClients(app.network.evmRpc, app.network.evmChainId, session.accounts[cfg.role]!.privateKey as `0x${string}`);
  const senderEvm = getAddress(wallet.account.address) as Address;
  const mentari = { address: getAddress(app.contracts.mentari), abi: loadArtifact("Mentari").abi };
  const read = <T>(functionName: string, args: readonly unknown[] = []) =>
    pub.readContract({ ...mentari, functionName, args } as never) as Promise<T>;
  const book = bookReader({ rest: app.network.rest, book: app.native.receiptsBook });
  const account = (a: string) => session.ctx.lane.account(a);
  const windowLive = async () => (await session.ctx.lane.window(actor.cosmos)).live;
  const held = () => read<bigint>("balanceOf", [senderEvm]);

  if (await windowLive()) throw new Error(`${cfg.role} has a live EVM window; case J needs it closed`);
  if ((await held()) < BigInt(cfg.retireWh)) {
    const stock = session.byRole(STOCK_FROM);
    const acct = await account(stock.cosmos);
    if (!acct) throw new Error(`${STOCK_FROM} has no funds`);
    const msg = crossVmCallMsg(stock.cosmos, mentari.address, mentari.abi, "transfer", [senderEvm, BigInt(cfg.stockWh)]);
    const fee = feeForGas(app.nativeLane, BigInt(app.nativeRoute.grantGas));
    const r = await session.submitter.submit(stock.sign({ messages: [msg], fee, ...acct, classical: false }));
    if (r.stage !== "block" || r.code !== 0) throw new Error(`stock transfer ${r.hash} failed: code ${r.code} ${r.log}`);
    console.log(`${STOCK_FROM} -> ${cfg.role}: ${cfg.stockWh} Wh of certificates (Native lane): ${r.hash}`);
  }

  const denom = app.nativeLane.denom;
  const env = {
    actor,
    submitter: session.submitter,
    account,
    windowLive,
    mentari,
    probe: async () => ({
      retirementsCount: String(await read<bigint>("retirementsCount")),
      [`balanceOf(${cfg.role})`]: String(await held()),
    }),
    receiptsAt: (height: number) => book.countAt(height),
    revertReason: async (spec: { functionName: string; args: readonly unknown[] }) => {
      try {
        await pub.simulateContract({ ...mentari, functionName: spec.functionName, args: spec.args, account: senderEvm } as never);
        return "the same call succeeds as an eth_call";
      } catch (err) {
        return describeRevert(err) ?? nodeMessage(err);
      }
    },
    lane: app.nativeLane,
    gas: cfg.gas,
    bank: bankReader({ rest: app.network.rest }),
    fee: feeMsg(actor.cosmos, to.cosmos, denom, cfg.feeUqor),
    to: { role: cfg.to, cosmos: to.cosmos },
    denom,
    amount: cfg.feeUqor,
  };

  const entries: BankFeeEntry[] = [];
  const [j] = bankFeeSpecs(cfg, 0n);
  const runJ = await runBankFee(env, j!.spec);
  console.log(describeRun("J", runJ));
  const [, j2] = bankFeeSpecs(cfg, await held());
  const runJ2 = await runBankFee(env, j2!.spec);
  console.log(describeRun("J2", runJ2));

  for (const [id, r] of [["J", runJ], ["J2", runJ2]] as const)
    entries.push({
      id,
      title: TITLES[id],
      sender: { role: cfg.role, cosmos: actor.cosmos, evm: senderEvm },
      ranAt: new Date().toISOString(),
      messages: BANK_FEE_MESSAGES,
      bank: r.bank,
      steps: [r.step],
    });
  writeEvidence(EVIDENCE, { ...prev, cases: [...(prev.cases ?? []), ...entries] });
  console.log("evidence/testnet.json cases J and J2 written");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(`bank-fee: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
