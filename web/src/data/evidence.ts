import type { Counts } from "./demo.js";

/** One recorded testnet case, as `scripts/cases` writes it to `evidence/testnet.json`. */
export interface EvidenceCase {
  id: string;
  expect: "success" | "revert";
  evm_tx: string;
  height: number | null;
  receipts: Counts | null;
  retirements: Counts | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const counts = (v: unknown): Counts | null =>
  isObj(v) && typeof v.before === "number" && typeof v.after === "number" ? { before: v.before, after: v.after } : null;

/** Accepts `{ cases: [...] }` or a bare list; skips entries without an id, an expectation and a transaction hash. */
export function parseEvidence(raw: unknown): EvidenceCase[] {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.cases) ? raw.cases : [];
  return list.flatMap((c: unknown) => {
    if (!isObj(c) || typeof c.id !== "string" || typeof c.evm_tx !== "string") return [];
    if (c.expect !== "success" && c.expect !== "revert") return [];
    return [
      {
        id: c.id,
        expect: c.expect,
        evm_tx: c.evm_tx,
        height: typeof c.height === "number" ? c.height : null,
        receipts: counts(c.receipts),
        retirements: counts(c.retirements),
      },
    ];
  });
}

export type Recheck = "confirmed" | "differs" | "unreadable" | "sample";

/**
 * Checks a recorded case against the chain again: the transaction must still be found with the status the case
 * expects. In sample mode there is no chain to ask, and the page says so.
 */
export async function recheckCase(
  c: EvidenceCase,
  txStatus: ((hash: string) => Promise<"success" | "reverted" | null>) | null,
): Promise<Recheck> {
  if (!txStatus) return "sample";
  try {
    const status = await txStatus(c.evm_tx);
    if (status === null) return "differs";
    return (status === "success") === (c.expect === "success") ? "confirmed" : "differs";
  } catch {
    return "unreadable";
  }
}
