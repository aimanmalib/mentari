import { MSG_SEND_TYPE_URL } from "@qorechain/sdk";
import type { Fetch } from "./lane.js";
import { CROSS_VM_CALL_TYPE_URL, runStep, type StepEnv, type StepRecord, type StepSpec } from "./native-entry.js";
import type { EncodeObject } from "./native.js";
import { fail, pass, type Check } from "./verify.js";

/**
 * Cases J and J2: a bank transfer and a contract call in one Native transaction. One hybrid-signed (secp256k1 +
 * ML-DSA-87) transaction carries two messages: a `MsgSend` of the retirement fee to the registrar, then a
 * `MsgCrossVMCall` into `Mentari.retire`. Case J retires certificates the sender holds: the fee, the certificates and
 * the Native receipt all move in one block. Case J2 asks to retire one Wh more than the sender holds: the contract
 * reverts, and the `MsgSend` that ran before it is undone with it. Nothing here retries or works around an answer.
 */

/** The `bankFee` block of config/app.json. */
export interface BankFeeConfig {
  /** The role that sends both transactions. Its EVM window must be closed. */
  role: string;
  /** The role that receives the fee. No recurring job sends to it, so its balance in that block moves only by this fee. */
  to: string;
  /** The retirement fee in uqor. */
  feeUqor: string;
  retireWh: number;
  memo: string;
  /** Gas limit of each two-message transaction. */
  gas: number;
  /** Certificates the demo sender gives the role, from the Native lane, when it holds fewer than `retireWh`. */
  stockWh: number;
}

/** The recipient's bank balance at the block before the transaction and at its block. */
export interface BankRecord {
  to: { role: string; cosmos: string };
  denom: string;
  amount: string;
  before: string;
  after: string;
}

/** Case J or J2 in `evidence/testnet.json` `cases`. `steps` holds the one transaction in the case H step format. */
export interface BankFeeEntry {
  id: "J" | "J2";
  title: string;
  sender: { role: string; cosmos: string; evm: string };
  ranAt: string;
  /** Message types of the one transaction, in order. */
  messages: string[];
  bank: BankRecord | null;
  steps: StepRecord[];
}

/** Read-only bank and transaction reads over public REST, at a block height when one is given. */
export interface BankReader {
  balanceAt(address: string, denom: string, height: number): Promise<bigint>;
  /** Message type URLs of a Cosmos transaction, or null when the node does not find it. */
  messageTypes(hash: string): Promise<string[] | null>;
}

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});

export function bankReader(opts: { rest: string; fetch?: Fetch }): BankReader {
  const base = opts.rest.replace(/\/+$/, "");
  const f: Fetch = opts.fetch ?? fetch;
  return {
    async balanceAt(address, denom, height) {
      const url = `${base}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${encodeURIComponent(denom)}`;
      const res = await f(url, { headers: { accept: "application/json", "x-cosmos-block-height": String(height) } });
      if (res.status !== 200) throw new Error(`balance ${address} at ${height}: HTTP ${res.status}`);
      const amount = obj(obj(await res.json().catch(() => undefined)).balance).amount;
      return typeof amount === "string" ? BigInt(amount) : 0n;
    },
    async messageTypes(hash) {
      const res = await f(`${base}/cosmos/tx/v1beta1/txs/${hash}`, { headers: { accept: "application/json" } });
      if (res.status !== 200) return null;
      const messages = obj(obj(obj(await res.json().catch(() => undefined)).tx).body).messages;
      return Array.isArray(messages) ? messages.map((m) => String(obj(m)["@type"])) : null;
    },
  };
}

/** The fee message: `from` pays `amount` of `denom` to `to`. */
export function feeMsg(from: string, to: string, denom: string, amount: string): EncodeObject {
  return { typeUrl: MSG_SEND_TYPE_URL, value: { fromAddress: from, toAddress: to, amount: [{ denom, amount }] } } as EncodeObject;
}

export const BANK_FEE_MESSAGES = [MSG_SEND_TYPE_URL, CROSS_VM_CALL_TYPE_URL];

/** The two cases. J retires what the sender holds; J2 asks for one Wh more than it holds, so the contract reverts. */
export function bankFeeSpecs(cfg: BankFeeConfig, heldAfterJ: bigint): { id: "J" | "J2"; spec: StepSpec }[] {
  return [
    {
      id: "J",
      spec: {
        step: 1,
        question: "One hybrid-signed transaction: MsgSend of the retirement fee to the registrar, then MsgCrossVMCall into Mentari.retire. Do the bank balance, the certificates and the Native receipt all move together?",
        functionName: "retire",
        args: [BigInt(cfg.retireWh), cfg.memo],
        contractWould: "burn the certificates and write one Native receipt",
      },
    },
    {
      id: "J2",
      spec: {
        step: 1,
        question: "The same two messages, but the retire asks for one Wh more than the sender holds. Is the fee transfer that ran first undone with it?",
        functionName: "retire",
        args: [heldAfterJ + 1n, cfg.memo],
        contractWould: "revert with InsufficientBalance",
      },
    },
  ];
}

export interface BankFeeEnv extends StepEnv {
  bank: BankReader;
  /** The fee message the sender signs ahead of the call. */
  fee: EncodeObject;
  to: { role: string; cosmos: string };
  denom: string;
  amount: string;
}

/** Send one case and read the recipient's balance at the block before and at the transaction's block. */
export async function runBankFee(env: BankFeeEnv, spec: StepSpec): Promise<{ step: StepRecord; bank: BankRecord | null }> {
  const step = await runStep({ ...env, leading: [env.fee] }, spec);
  const h = step.height;
  if (h === null) return { step, bank: null };
  const at = (height: number) => env.bank.balanceAt(env.to.cosmos, env.denom, height).then(String);
  return { step, bank: { to: env.to, denom: env.denom, amount: env.amount, before: await at(h - 1), after: await at(h) } };
}

/** What `pnpm verify` adds for J and J2: the transaction has both messages, and the fee arrived only when it ran. */
export async function bankChecks(bank: BankReader, cases: readonly unknown[]): Promise<Check[]> {
  const out: Check[] = [];
  for (const c of cases as Partial<BankFeeEntry>[]) {
    if (!c.bank || !c.steps?.[0] || !Array.isArray(c.messages)) continue;
    const s = c.steps[0];
    const label = `case ${c.id}`;
    const types = await bankRead(() => bank.messageTypes(s.cosmos_tx));
    const msgName = `${label} one transaction carries ${c.messages.map((m) => m.split(".").pop()).join(" + ")}`;
    if (types === undefined || types === null) out.push({ group: "cases", name: msgName, outcome: "unavailable", detail: "the node did not find it" });
    else out.push(types.join() === c.messages.join() ? pass("cases", msgName, s.cosmos_tx) : fail("cases", msgName, types.join(", ")));

    if (s.height === null) continue;
    const moved = s.accepted ? BigInt(c.bank.amount) : 0n;
    const name = `${label} registrar balance ${s.accepted ? `gained the fee of ${c.bank.amount} ${c.bank.denom}` : "unchanged"} at block ${s.height}`;
    const before = await bankRead(() => bank.balanceAt(c.bank!.to.cosmos, c.bank!.denom, s.height! - 1));
    const after = await bankRead(() => bank.balanceAt(c.bank!.to.cosmos, c.bank!.denom, s.height!));
    if (before === undefined || after === undefined)
      out.push({ group: "cases", name, outcome: "unavailable", detail: "the node does not keep state that old" });
    else out.push(after - before === moved ? pass("cases", name, `${before} -> ${after}`) : fail("cases", name, `${before} -> ${after}`));
  }
  return out;
}

async function bankRead<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/** The outcome in one line, for the console. */
export function describeRun(id: string, r: { step: StepRecord; bank: BankRecord | null }): string {
  const s = r.step;
  const lines = [`case ${id}: ${s.accepted ? "accepted" : "not accepted"} (${s.stage}, code ${s.code} ${s.codespace}) ${s.cosmos_tx}`];
  if (r.bank) lines.push(`  ${r.bank.to.role} ${r.bank.denom}: ${r.bank.before} -> ${r.bank.after}`);
  if (s.receipts) lines.push(`  receipts book count: ${s.receipts.before} -> ${s.receipts.after}`);
  for (const x of s.state) lines.push(`  ${x.name}: ${x.before} -> ${x.after}`);
  if (!s.accepted) lines.push(`  ${s.revert_reason ?? s.log}`);
  return lines.join("\n");
}
