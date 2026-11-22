import type { Agreement, PairCheck, PairProblem, Receipt, Retirement } from "./types.js";

/** The note `Mentari.retire` writes: `MTR1 n=<n> wh=<wh> by=0x<40 lowercase hex> m=<memo>`. */
export function notePrefix(r: Pick<Retirement, "n" | "wh" | "holder">): string {
  return `MTR1 n=${r.n} wh=${r.wh} by=${r.holder.toLowerCase()} m=`;
}

/**
 * Compares one EVM retirement with the Native receipt it points to. The receipt must exist, come from the
 * Mentari contract's Native address and carry the note the contract built for this retirement.
 */
export function checkPair(r: Retirement, receipt: Receipt | null, contractNative: string): PairCheck {
  const problems: PairProblem[] = [];
  if (!receipt || receipt.id !== r.receiptId) {
    problems.push("missing-receipt");
  } else {
    if (receipt.sender !== contractNative) problems.push("wrong-sender");
    if (!receipt.note.startsWith(notePrefix(r))) problems.push("wrong-note");
  }
  return { n: r.n, receiptId: r.receiptId, ok: problems.length === 0, problems };
}

/** Both ledgers agree when every checked pair matches and the EVM count covers what was checked. */
export function summarise(pairs: PairCheck[], total: number): Agreement {
  if (total === 0) return { state: "empty" };
  const failed = pairs.filter((p) => !p.ok);
  if (pairs.length === 0) return { state: "disagree", checked: 0, total, failed: [] };
  return failed.length === 0
    ? { state: "agree", checked: pairs.length, total }
    : { state: "disagree", checked: pairs.length, total, failed };
}

/** Retirement numbers to check: the latest `limit`, newest first. Numbering starts at 1. */
export function latestNumbers(count: number, limit: number): number[] {
  const out: number[] = [];
  for (let n = count; n >= 1 && out.length < limit; n--) out.push(n);
  return out;
}
