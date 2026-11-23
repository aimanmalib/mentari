import type { BookReader, Receipt } from "./book.js";

/**
 * The checks behind `pnpm verify`. Everything here reads public endpoints through the readers passed in; nothing
 * signs or sends. Each check passes, fails, or is `unavailable` when the node cannot answer a historical read
 * (a pruned node, say). Unavailable checks are shown and not counted as passed; only a failure makes verify exit 1.
 */

export type Outcome = "pass" | "fail" | "unavailable";

export interface Check {
  group: "contracts" | "retirements" | "totals" | "cases" | "live";
  name: string;
  outcome: Outcome;
  detail?: string;
}

export interface OnChainRetirement {
  holder: string;
  wh: bigint;
  receiptId: bigint;
}

export interface TxResult {
  status: "success" | "reverted";
  to: string | null;
}

/** Read-only view of the Mentari contract and the EVM lane. */
export interface EvmReader {
  hasCode(address: string): Promise<boolean>;
  receiptsBook(): Promise<string>;
  retirementsCount(): Promise<bigint>;
  retirement(n: bigint): Promise<OnChainRetirement>;
  totals(): Promise<{ minted: bigint; retired: bigint; supply: bigint }>;
  /** Null when the node has no receipt for the hash. */
  tx(hash: string): Promise<TxResult | null>;
}

/** One case as `evidence/testnet.json` records it. */
export interface RecordedCase {
  id: string;
  expect: "success" | "revert";
  contract: string;
  evm_tx: string;
  cosmos_tx: string;
  height: number;
  receipt?: { id: number; sender: string; note: string };
}

/** Case H as `pnpm native-entry` records it: Native transactions only, no EVM transaction of its own. */
export interface RecordedEntry {
  id: "H";
  steps: readonly { step: number; function: string; cosmos_tx: string; height: number | null; accepted: boolean }[];
}

const isEntry = (c: RecordedCase | RecordedEntry): c is RecordedEntry => Array.isArray((c as RecordedEntry).steps);

export interface VerifyInput {
  mentari: string;
  atomicityProbe: string;
  /** The Mentari contract's Native (bech32) address: the sender every receipt must carry. */
  mentariNative: string;
  /** The receipts book the configuration names; the contract's own value must match it. */
  receiptsBook: string;
  cases: readonly (RecordedCase | RecordedEntry)[];
  /** Retirements read at once. */
  concurrency: number;
}

/** The note `Mentari.retire` writes: `MTR1 n=<n> wh=<wh> by=0x<40 lowercase hex> m=<memo>`. */
export function noteFor(n: bigint, wh: bigint, holder: string): string {
  return `MTR1 n=${n} wh=${wh} by=${holder.toLowerCase()} m=`;
}

export const pass = (group: Check["group"], name: string, detail?: string): Check =>
  detail === undefined ? { group, name, outcome: "pass" } : { group, name, outcome: "pass", detail };
export const fail = (group: Check["group"], name: string, detail: string): Check => ({ group, name, outcome: "fail", detail });
export const sameAddress = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function contractChecks(evm: EvmReader, input: VerifyInput): Promise<Check[]> {
  const out: Check[] = [];
  for (const [label, address] of [["Mentari", input.mentari], ["AtomicityProbe", input.atomicityProbe]] as const) {
    const name = `${label} has code at ${address}`;
    out.push((await evm.hasCode(address)) ? pass("contracts", name) : fail("contracts", name, "no code"));
  }
  const book = await evm.receiptsBook();
  out.push(
    book === input.receiptsBook
      ? pass("contracts", "Mentari writes to the configured receipts book")
      : fail("contracts", "Mentari writes to the configured receipts book", `contract says ${book}`),
  );
  return out;
}

type PairRow = Check & { r?: OnChainRetirement };

async function pairCheck(evm: EvmReader, book: BookReader, input: VerifyInput, n: bigint): Promise<PairRow> {
  const r = await evm.retirement(n);
  const name = `retirement ${n} matches receipt ${r.receiptId}`;
  let receipt: Receipt;
  try {
    receipt = await book.receipt(Number(r.receiptId));
  } catch (err) {
    return { ...fail("retirements", name, `receipt not read: ${message(err)}`), r };
  }
  const problems: string[] = [];
  if (receipt.id !== Number(r.receiptId)) problems.push(`book returned id ${receipt.id}`);
  if (receipt.sender !== input.mentariNative) problems.push(`sender ${receipt.sender}`);
  if (!receipt.note.startsWith(noteFor(n, r.wh, r.holder))) problems.push(`note "${receipt.note}"`);
  return problems.length === 0 ? { ...pass("retirements", name), r } : { ...fail("retirements", name, problems.join("; ")), r };
}

async function retirementChecks(evm: EvmReader, book: BookReader, input: VerifyInput): Promise<Check[]> {
  const count = await evm.retirementsCount();
  const ns = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
  const rows: PairRow[] = [];
  for (let i = 0; i < ns.length; i += input.concurrency) {
    rows.push(...(await Promise.all(ns.slice(i, i + input.concurrency).map((n) => pairCheck(evm, book, input, n)))));
  }
  const out: Check[] = rows.map(({ r: _r, ...check }) => check);

  // Receipt ids rise with the retirement number (invariant I3 on the chain).
  const ids = rows.map((x) => x.r?.receiptId ?? 0n);
  const unordered = ids.findIndex((id, i) => i > 0 && id <= ids[i - 1]!);
  out.push(
    unordered === -1
      ? pass("retirements", `receipt ids rise with the retirement number (${count} retirements)`)
      : fail("retirements", "receipt ids rise with the retirement number", `retirement ${unordered + 1}`),
  );

  const totals = await evm.totals();
  const sum = rows.reduce((acc, x) => acc + (x.r?.wh ?? 0n), 0n);
  out.push(
    totals.minted - totals.retired === totals.supply
      ? pass("totals", `minted ${totals.minted} - retired ${totals.retired} = supply ${totals.supply}`)
      : fail("totals", "minted - retired = supply", `${totals.minted} - ${totals.retired} != ${totals.supply}`),
    sum === totals.retired
      ? pass("totals", `the ${count} retirements add up to retired ${totals.retired} Wh`)
      : fail("totals", "the retirements add up to retired", `sum ${sum} != retired ${totals.retired}`),
  );
  return out;
}

/** Receipts book count just before and at the case's block, or null when the node cannot serve those heights. */
export async function countsAround(book: BookReader, height: number): Promise<[number, number] | null> {
  try {
    return [await book.countAt(height - 1), await book.countAt(height)];
  } catch {
    return null;
  }
}

async function caseChecks(evm: EvmReader, book: BookReader, input: VerifyInput, c: RecordedCase): Promise<Check[]> {
  const label = `case ${c.id}`;
  const want = c.expect === "success" ? "success" : "reverted";
  const tx = await evm.tx(c.evm_tx);
  const out: Check[] = [];
  if (!tx) return [fail("cases", `${label} EVM transaction ${want}`, `no receipt for ${c.evm_tx}`)];
  out.push(
    tx.status === want && sameAddress(tx.to, c.contract)
      ? pass("cases", `${label} EVM transaction ${want}`)
      : fail("cases", `${label} EVM transaction ${want}`, `status ${tx.status}, to ${tx.to}`),
  );

  let cosmos: string | null = null;
  try {
    cosmos = await book.cosmosTxOf(c.evm_tx);
  } catch {
    // reported as unavailable below
  }
  out.push(
    cosmos === null
      ? { group: "cases", name: `${label} Cosmos transaction`, outcome: "unavailable", detail: "the node did not find it" }
      : cosmos === c.cosmos_tx
        ? pass("cases", `${label} Cosmos transaction ${cosmos}`)
        : fail("cases", `${label} Cosmos transaction`, `node says ${cosmos}, evidence says ${c.cosmos_tx}`),
  );

  const counts = await countsAround(book, c.height);
  const bookName = `${label} receipts book ${c.expect === "success" ? "gained a receipt" : "unchanged"} at block ${c.height}`;
  if (!counts) {
    out.push({ group: "cases", name: bookName, outcome: "unavailable", detail: "the node does not keep state that old" });
  } else {
    const [before, after] = counts;
    const ok = c.expect === "success" ? after > before : after === before;
    out.push(ok ? pass("cases", bookName, `${before} -> ${after}`) : fail("cases", bookName, `${before} -> ${after}`));
  }

  if (c.receipt) {
    const name = `${label} receipt ${c.receipt.id} as recorded`;
    try {
      const r = await book.receipt(c.receipt.id);
      out.push(
        r.sender === c.receipt.sender && r.note === c.receipt.note && r.sender === input.mentariNative
          ? pass("cases", name)
          : fail("cases", name, `sender ${r.sender}, note "${r.note}"`),
      );
    } catch (err) {
      out.push(fail("cases", name, `receipt not read: ${message(err)}`));
    }
  }
  return out;
}

/** Each step of case H: the node has its Cosmos transaction with the recorded outcome, and the book moved to match. */
async function entryChecks(book: BookReader, c: RecordedEntry): Promise<Check[]> {
  const out: Check[] = [];
  for (const s of c.steps) {
    const label = `case H step ${s.step} ${s.function}`;
    const want = s.accepted ? "accepted" : "not accepted";
    let tx: { code: number; height: number } | null = null;
    try {
      tx = await book.cosmosTx(s.cosmos_tx);
    } catch {
      // reported as unavailable below
    }
    const txName = `${label} Cosmos transaction ${want}`;
    if (!tx) out.push({ group: "cases", name: txName, outcome: "unavailable", detail: "the node did not find it" });
    else
      out.push(
        (tx.code === 0) === s.accepted && tx.height === s.height
          ? pass("cases", txName, s.cosmos_tx)
          : fail("cases", txName, `code ${tx.code} at block ${tx.height}`),
      );
    if (s.height === null) continue;
    const bookName = `${label} receipts book ${s.accepted && s.function === "retire" ? "gained a receipt" : "unchanged"} at block ${s.height}`;
    const counts = await countsAround(book, s.height);
    if (!counts) {
      out.push({ group: "cases", name: bookName, outcome: "unavailable", detail: "the node does not keep state that old" });
      continue;
    }
    const [before, after] = counts;
    const ok = s.accepted && s.function === "retire" ? after === before + 1 : after === before;
    out.push(ok ? pass("cases", bookName, `${before} -> ${after}`) : fail("cases", bookName, `${before} -> ${after}`));
  }
  return out;
}

export async function runVerify(evm: EvmReader, book: BookReader, input: VerifyInput): Promise<Check[]> {
  const checks = [...(await contractChecks(evm, input)), ...(await retirementChecks(evm, book, input))];
  const perCase = await Promise.all(input.cases.map((c) => (isEntry(c) ? entryChecks(book, c) : caseChecks(evm, book, input, c))));
  return [...checks, ...perCase.flat()];
}

export interface Summary {
  checks: number;
  passed: number;
  failed: number;
  unavailable: number;
}

export function summarise(checks: readonly Check[]): Summary {
  const count = (o: Outcome) => checks.filter((c) => c.outcome === o).length;
  return { checks: checks.length, passed: count("pass"), failed: count("fail"), unavailable: count("unavailable") };
}

const MARK: Record<Outcome, string> = { pass: "ok  ", fail: "FAIL", unavailable: "n/a " };

export function formatReport(checks: readonly Check[]): string {
  const lines = checks.map((c) => `${MARK[c.outcome]} ${c.group.padEnd(11)} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  const s = summarise(checks);
  lines.push(
    "",
    `${s.passed} of ${s.checks} checks passed, ${s.failed} failed${s.unavailable ? `, ${s.unavailable} not available from this node` : ""}.`,
  );
  return lines.join("\n");
}
