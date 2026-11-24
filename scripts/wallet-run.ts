/**
 * wallet-run: the Try it wallet path on the testnet, signed the way QoreX signs today.
 *
 *   pnpm wallet-run     register the key, get certificates from the live site, retire through the Native lane
 *
 * The page hands QoreX one Native message per step and QoreX adds the hybrid secp256k1 + ML-DSA-87 signature
 * (`signAndBroadcast`). Here the QoreX wallet mock (`@qorechain/qorex-wallet-mock`, profile `current`) does that
 * signing, on its own account of the shared seed (config/app.json `walletRun.accountIndex`), with the same message
 * bytes the page builds. Writes evidence/wallet-native.json. Output is public data only: addresses, amounts, hashes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bank } from "@qorechain/sdk";
import { createQorexMock } from "@qorechain/qorex-wallet-mock";
import { getAddress, type Address } from "viem";
import { nativeToEvm } from "../web/src/data/address.js";
import { mentariReadAbi, mentariWalletAbi } from "../web/src/data/abi.js";
import { requestGrant } from "../web/src/data/grant.js";
import { retireCall, selfSend, type EncodedMessage } from "../web/src/wallet/nativeMsgs.js";
import { accountsPath, readAccountsFile } from "./src/accounts.js";
import { bookReader } from "./src/book.js";
import { loadAppConfig, type AppConfig } from "./src/config.js";
import { feeForGas, type NativeSettings } from "./src/native.js";
import { evmClients } from "./src/rpc.js";
import { nativeSession } from "./src/session.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const EVIDENCE = join(repoRoot, "evidence", "wallet-native.json");

type App = AppConfig &
  NativeSettings & {
    accounts: Record<string, string>;
    contracts: { mentari: string };
    native: { receiptsBook: string };
    nativeRoute: { retireGas: number };
    web: { demoApi: string; wallet: { memo: string; keySetupUqor: string } };
    walletRun: { accountIndex: number; fundFrom: string; fundUqor: string; site: string };
  };

interface Step {
  step: string;
  cosmos_tx: string;
  code: number;
  /** QoreX's reading of the committed transaction: `shielded` = it carries the hybrid ML-DSA-87 layer. */
  shield?: string;
}

/** A window object just large enough for the mock to install into (EIP-6963 events and `window.qorex`). */
function mockWindow() {
  const win = Object.assign(new EventTarget(), { CustomEvent, navigator: {} }) as unknown as Window & typeof globalThis;
  return win as Window & { qorex?: { native: QorexNative } };
}

interface QorexNative {
  getKey(chainId: string): Promise<{ bech32Address: string }>;
  signAndBroadcast(r: { chainId: string; messages: EncodedMessage[]; gasLimit?: number }): Promise<{ txHash: string; code: number; shield: string }>;
}

async function main(): Promise<void> {
  const app = loadAppConfig() as App;
  const run = app.walletRun;
  if (Object.keys(app.accounts).includes(String(run.accountIndex))) {
    throw new Error(`walletRun.accountIndex ${run.accountIndex} is a project account in config/app.json accounts`);
  }
  const { mnemonic } = readAccountsFile(accountsPath(process.env, repoRoot));
  const chainId = app.network.chainId;
  const win = mockWindow();
  createQorexMock({ mnemonic, accountIndex: run.accountIndex, profile: "current", chainId: chainId as "qorechain-diana", rest: app.network.rest, evmRpc: app.network.evmRpc }).install(win);
  const qorex = win.qorex!.native;
  const native = (await qorex.getKey(chainId)).bech32Address;
  const evm = nativeToEvm(native);
  const steps: Step[] = [];
  const send = async (step: string, message: EncodedMessage, gasLimit?: number) => {
    const out = await qorex.signAndBroadcast({ chainId, messages: [message], ...(gasLimit ? { gasLimit } : {}) });
    const hash = out.txHash.replace(/^0x/i, "").toUpperCase();
    steps.push({ step, cosmos_tx: hash, code: out.code, shield: out.shield });
    console.log(`${step}: ${hash} code ${out.code}, ${out.shield}`);
    if (out.code !== 0) throw new Error(`${step} failed with code ${out.code}`);
  };

  const session = await nativeSession(app, mnemonic, [run.fundFrom]);
  const funder = session.byRole(run.fundFrom);
  if ([funder.cosmos].includes(native)) throw new Error("the wallet account is a project account");
  const balanceUqor = async () => {
    const r = await fetch(`${app.network.rest}/cosmos/bank/v1beta1/balances/${native}/by_denom?denom=${app.nativeLane.denom}`);
    return BigInt(((await r.json()) as { balance?: { amount?: string } }).balance?.amount ?? "0");
  };
  console.log(`wallet account ${native} (EVM form ${evm}), ${await balanceUqor()} uqor`);

  if ((await balanceUqor()) * 2n < BigInt(run.fundUqor)) {
    const acct = await session.ctx.lane.account(funder.cosmos);
    if (!acct) throw new Error(`${run.fundFrom} has no funds`);
    const msg = bank.send({ fromAddress: funder.cosmos, toAddress: native, amount: [{ denom: app.nativeLane.denom, amount: run.fundUqor }] });
    const r = await session.submitter.submit(funder.sign({ messages: [msg as never], fee: feeForGas(app.nativeLane, 400_000n), ...acct, classical: false }));
    if (r.stage !== "block" || r.code !== 0) throw new Error(`funding ${r.hash} failed: code ${r.code} ${r.log}`);
    steps.push({ step: `fund: ${run.fundFrom} sends ${run.fundUqor} uqor (project script, not the wallet)`, cosmos_tx: r.hash, code: r.code });
    console.log(`funded: ${r.hash}`);
  }

  const { pub } = evmClients(app.network.evmRpc, app.network.evmChainId, `0x${"11".repeat(32)}`);
  const mentari = getAddress(app.contracts.mentari) as Address;
  const read = <T>(abi: readonly unknown[], functionName: string, args: readonly unknown[]) =>
    pub.readContract({ address: mentari, abi, functionName, args } as never) as Promise<T>;
  const readyBefore = await read<boolean>(mentariWalletAbi, "isQuantumReady", [evm]);
  if (!readyBefore) await send("register key: the page's 1 uqor send to itself; QoreX registers ML-DSA-87 first", selfSend(native, "uqor", app.web.wallet.keySetupUqor));
  const readyAfter = await read<boolean>(mentariWalletAbi, "isQuantumReady", [evm]);
  if (!readyAfter) throw new Error("the contract still sees no ML-DSA-87 key for the wallet account");

  const limits = JSON.parse(readFileSync(join(repoRoot, "config", "limits.json"), "utf8")) as { demo: { retireWh: number } };
  const wh = BigInt(limits.demo.retireWh);
  let held = await read<bigint>(mentariWalletAbi, "balanceOf", [evm]);
  if (held < wh) {
    const grant = await requestGrant((u, i) => fetch(u, i as RequestInit), `${run.site}${app.web.demoApi}`, evm);
    if (grant.kind !== "sent") throw new Error(`the live grant was refused: ${grant.reason}`);
    steps.push({ step: `grant: the live site's demo account sends ${grant.wh} Wh (${grant.lane} lane)`, cosmos_tx: grant.hash, code: 0 });
    console.log(`granted ${grant.wh} Wh: ${grant.hash}`);
    held = await read<bigint>(mentariWalletAbi, "balanceOf", [evm]);
  }

  const memo = app.web.wallet.memo;
  const { result } = await pub.simulateContract({ account: evm, address: mentari, abi: mentariWalletAbi, functionName: "retire", args: [wh, memo] });
  await send("retire: Mentari.retire from the Native lane, signed in the wallet", retireCall(native, mentari, wh, memo), app.nativeRoute.retireGas);
  const n = result[0];
  const r = await read<{ holder: string; wh: bigint; receiptId: bigint }>(mentariReadAbi, "retirement", [n]);
  const after = await read<bigint>(mentariWalletAbi, "balanceOf", [evm]);
  // The Native receipt the bridge call wrote, read back from the receipts book.
  const receipt = await bookReader({ rest: app.network.rest, book: app.native.receiptsBook }).receipt(Number(r.receiptId));

  const record = {
    what: "The Try it wallet path on the testnet: QoreX signAndBroadcast, Native lane, no EVM window",
    signer: "@qorechain/qorex-wallet-mock 0.1.0, profile current (what QoreX does today), not the QoreX extension",
    recorded_at: new Date().toISOString(),
    account: { native, evm, key_ready_before: readyBefore, key_ready_after: readyAfter },
    steps,
    retirement: { n: Number(n), holder: r.holder, wh: Number(r.wh), receipt_id: Number(r.receiptId), holder_is_wallet: r.holder.toLowerCase() === evm.toLowerCase() },
    certificates: { before: Number(held), after: Number(after) },
    native_receipt: receipt,
  };
  writeFileSync(EVIDENCE, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`retirement ${n} by ${r.holder}; certificates ${held} -> ${after}; Native receipt ${r.receiptId}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
