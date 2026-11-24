import { evmToNative } from "./address.js";
import { checkPair, latestNumbers } from "./agree.js";
import type { ReceiptsBook } from "./native.js";
import type { MentariReader } from "./registry.js";
import type { PairCheck, Receipt, Retirement } from "./types.js";

/** One retirement read on both ledgers: the EVM record, its Native receipt and the check between them. */
export interface RetirementRecord {
  retirement: Retirement;
  receipt: Receipt | null;
  /** Null when no `Retired` log was found: Native-lane retirements emit none the EVM node indexes (decision 0034). */
  evmTx: string | null;
  check: PairCheck;
}

export interface RecordsOptions {
  contract: string;
  nativePrefix: string;
}

type Book = Pick<ReceiptsBook, "receipt">;

async function txsOrEmpty(evm: MentariReader, ns: number[]): Promise<Map<number, string>> {
  try {
    return await evm.retiredTxs(ns);
  } catch {
    // The rows still show both ledgers; only the transaction link is missing.
    return new Map();
  }
}

async function readRecords(evm: MentariReader, book: Book, ns: number[], contractNative: string): Promise<RetirementRecord[]> {
  const [txs, rows] = await Promise.all([
    txsOrEmpty(evm, ns),
    Promise.all(
      ns.map(async (n) => {
        const retirement = await evm.retirement(n);
        return { retirement, receipt: await book.receipt(retirement.receiptId) };
      }),
    ),
  ]);
  return rows.map(({ retirement, receipt }) => ({
    retirement,
    receipt,
    evmTx: txs.get(retirement.n) ?? null,
    check: checkPair(retirement, receipt, contractNative),
  }));
}

export interface RetirementsPage {
  total: number;
  contractNative: string;
  records: RetirementRecord[];
  /** Number to ask for to see the next older page, or null on the last page. */
  olderFrom: number | null;
}

/** Retirements newest first, `pageSize` at a time, starting at number `from` (default: the newest). */
export async function readRetirementsPage(
  evm: MentariReader,
  book: Book,
  opts: RecordsOptions & { pageSize: number; from?: number | null },
): Promise<RetirementsPage> {
  const contractNative = evmToNative(opts.contract, opts.nativePrefix);
  const total = await evm.retirementsCount();
  const top = Math.min(opts.from ?? total, total);
  const ns = latestNumbers(top, opts.pageSize);
  const records = await readRecords(evm, book, ns, contractNative);
  const last = ns.at(-1);
  return { total, contractNative, records, olderFrom: last !== undefined && last > 1 ? last - 1 : null };
}

export type VerifyQuery = { kind: "n" | "receipt"; value: number };

/** `?n=<retirement number>` or `?receipt=<receipt id>`, positive whole numbers only. */
export function parseVerifyQuery(search: string): VerifyQuery | null {
  const params = new URLSearchParams(search);
  for (const kind of ["n", "receipt"] as const) {
    const raw = params.get(kind);
    if (raw !== null && /^[1-9]\d{0,15}$/.test(raw.trim())) {
      const value = Number(raw.trim());
      if (Number.isSafeInteger(value)) return { kind, value };
    }
  }
  return null;
}

export function verifySearch(q: VerifyQuery): string {
  return `?${q.kind}=${q.value}`;
}

/** The retirement number written in a Mentari receipt note (`MTR1 n=<n> ...`), or null for any other note. */
export function noteNumber(note: string): number | null {
  const m = /^MTR1 n=([1-9]\d{0,15}) /.exec(note);
  return m ? Number(m[1]) : null;
}

export type VerifyCheck = "receipt-exists" | "same-id" | "sender" | "note";

export type VerifyReport =
  | { state: "not-found"; query: VerifyQuery }
  /** The receipt exists but was not written by the Mentari contract. */
  | { state: "not-mentari"; query: VerifyQuery; receipt: Receipt; contractNative: string }
  /** The receipt names a retirement number the contract does not have. */
  | { state: "orphan"; query: VerifyQuery; receipt: Receipt; n: number }
  | { state: "checked"; query: VerifyQuery; record: RetirementRecord; checks: { code: VerifyCheck; ok: boolean }[]; ok: boolean };

function checksOf(record: RetirementRecord, query: VerifyQuery): { code: VerifyCheck; ok: boolean }[] {
  const { retirement, receipt, check } = record;
  const sameId = receipt !== null && receipt.id === retirement.receiptId && (query.kind === "n" || query.value === receipt.id);
  return [
    { code: "receipt-exists", ok: receipt !== null },
    { code: "same-id", ok: sameId },
    { code: "sender", ok: receipt !== null && !check.problems.includes("wrong-sender") },
    { code: "note", ok: receipt !== null && !check.problems.includes("wrong-note") },
  ];
}

/** Looks one retirement up by its number or by its receipt id and checks the two ledgers against each other. */
export async function verify(evm: MentariReader, book: Book, query: VerifyQuery, opts: RecordsOptions): Promise<VerifyReport> {
  const contractNative = evmToNative(opts.contract, opts.nativePrefix);
  let n = query.value;
  if (query.kind === "receipt") {
    const receipt = await book.receipt(query.value);
    if (!receipt) return { state: "not-found", query };
    const named = noteNumber(receipt.note);
    if (receipt.sender !== contractNative || named === null) return { state: "not-mentari", query, receipt, contractNative };
    if (named > (await evm.retirementsCount())) return { state: "orphan", query, receipt, n: named };
    n = named;
  } else if (n > (await evm.retirementsCount())) {
    return { state: "not-found", query };
  }
  const [record] = await readRecords(evm, book, [n], contractNative);
  const checks = checksOf(record!, query);
  return { state: "checked", query, record: record!, checks, ok: checks.every((c) => c.ok) };
}
