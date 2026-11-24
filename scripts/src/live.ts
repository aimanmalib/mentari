import type { BookReader } from "./book.js";
import { countsAround, fail, pass, sameAddress, type Check, type EvmReader } from "./verify.js";

/**
 * `evidence/live.json`: the buttons of the public Try it page pressed in real browsers, with what the server answered.
 * `liveChecks` reads every recorded transaction back from public endpoints, so the record can be checked by anyone.
 */

export type LiveAction = "retire" | "case-b" | "case-c" | "case-d";

export interface LiveRun {
  n: number;
  at: string;
  action: LiveAction;
  browser: "chromium" | "webkit";
  viewport: string;
  lang: "en" | "ms";
  /** Native lane runs record a Cosmos transaction; failure buttons pressed before decision 0030 recorded an EVM one. */
  cosmosTx?: string;
  evmTx?: string;
  /** Block of the Cosmos transaction, read back from the node when the record was written. */
  height?: number;
  txStatus: "success" | "reverted";
  receipts: { before: number; after: number };
  retirements: { before: number; after: number };
  asExpected: boolean;
  consoleErrors: number;
  overflowPx: number;
}

export interface LiveRecord {
  site: string;
  /** The claim the record makes: Retire now succeeded this many times in a row. */
  retireStreak: number;
  runs: readonly LiveRun[];
}

const label = (r: LiveRun) => `run ${r.n} ${r.action} (${r.browser} ${r.viewport} ${r.lang})`;

/** What the page showed: retire adds one to both ledgers, each failure leaves both as they were, no page errors. */
export function recordChecks(record: LiveRecord): Check[] {
  return record.runs.map((r) => {
    const step = r.action === "retire" ? 1 : 0;
    const moved = r.receipts.after - r.receipts.before === step && r.retirements.after - r.retirements.before === step;
    const wantStatus = step ? "success" : "reverted";
    const name = `${label(r)} ${step ? "both ledgers up by one" : "both ledgers unchanged"}`;
    const problems = [
      moved ? "" : `receipts ${r.receipts.before} -> ${r.receipts.after}, retirements ${r.retirements.before} -> ${r.retirements.after}`,
      r.txStatus === wantStatus ? "" : `status ${r.txStatus}`,
      r.asExpected ? "" : "page said not as expected",
      r.consoleErrors === 0 ? "" : `${r.consoleErrors} console errors`,
      r.overflowPx <= 0 ? "" : `page ${r.overflowPx} px wider than the screen`,
    ].filter(Boolean);
    return problems.length === 0 ? pass("live", name) : fail("live", name, problems.join("; "));
  });
}

/** Retire now `count` times in a row: the record must hold that many retire runs with no failed one between them. */
export function streakCheck(record: LiveRecord, count: number): Check {
  let best = 0;
  let run = 0;
  for (const r of [...record.runs].filter((x) => x.action === "retire").sort((a, b) => a.n - b.n)) {
    const ok = r.txStatus === "success" && r.asExpected;
    run = ok ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const name = `Retire now succeeded ${count} times in a row`;
  return best >= count ? pass("live", name) : fail("live", name, `longest run ${best}`);
}

type CosmosTx = Awaited<ReturnType<BookReader["cosmosTx"]>>;

/** The Cosmos transaction, or null when the node cannot find it or does not answer (reported as unavailable). */
async function readCosmos(book: BookReader, hash: string): Promise<CosmosTx> {
  try {
    return await book.cosmosTx(hash);
  } catch {
    return null;
  }
}

/**
 * A failure button sent from the Native lane (decision 0030): the chain must have taken the transaction into a block
 * with the EVM revert code (`revertCodespace`), and the receipts book must hold the same count before and after it.
 */
async function nativeRevertCheck(book: BookReader, r: LiveRun & { cosmosTx: string }, revertCodespace: string): Promise<Check[]> {
  const name = `${label(r)} Native transaction reverted inside the EVM call`;
  const tx = await readCosmos(book, r.cosmosTx);
  if (!tx) return [{ group: "live", name, outcome: "unavailable", detail: "the node did not find it" }];
  const reverted = tx.code !== 0 && tx.codespace === revertCodespace && (r.height === undefined || tx.height === r.height);
  const out = [reverted ? pass("live", name, r.cosmosTx) : fail("live", name, `code ${tx.code} ${tx.codespace ?? ""} at block ${tx.height}`.trim())];
  const counts = await countsAround(book, tx.height);
  const bookName = `${label(r)} receipts book unchanged at block ${tx.height}`;
  if (!counts) out.push({ group: "live", name: bookName, outcome: "unavailable", detail: "the node does not keep state that old" });
  else out.push(counts[1] === counts[0] ? pass("live", bookName) : fail("live", bookName, `${counts[0]} -> ${counts[1]}`));
  return out;
}

async function chainCheck(evm: EvmReader, book: BookReader, contracts: readonly string[], r: LiveRun, revertCodespace: string): Promise<Check[]> {
  if (r.action !== "retire" && r.cosmosTx && !r.evmTx) return nativeRevertCheck(book, { ...r, cosmosTx: r.cosmosTx }, revertCodespace);
  if (r.action === "retire") {
    const name = `${label(r)} Cosmos transaction accepted`;
    if (!r.cosmosTx) return [fail("live", name, "no Cosmos transaction recorded")];
    const tx = await readCosmos(book, r.cosmosTx);
    if (!tx) return [{ group: "live", name, outcome: "unavailable", detail: "the node did not find it" }];
    const out = [tx.code === 0 && (r.height === undefined || tx.height === r.height) ? pass("live", name, r.cosmosTx) : fail("live", name, `code ${tx.code} at block ${tx.height}`)];
    const counts = await countsAround(book, tx.height);
    const bookName = `${label(r)} receipts book gained a receipt at block ${tx.height}`;
    if (!counts) out.push({ group: "live", name: bookName, outcome: "unavailable", detail: "the node does not keep state that old" });
    else out.push(counts[1] === counts[0] + 1 ? pass("live", bookName) : fail("live", bookName, `${counts[0]} -> ${counts[1]}`));
    return out;
  }
  const name = `${label(r)} EVM transaction reverted`;
  if (!r.evmTx) return [fail("live", name, "no EVM transaction recorded")];
  const tx = await evm.tx(r.evmTx);
  if (!tx) return [fail("live", name, `no receipt for ${r.evmTx}`)];
  return [tx.status === "reverted" && contracts.some((c) => sameAddress(tx.to, c)) ? pass("live", name) : fail("live", name, `status ${tx.status}, to ${tx.to}`)];
}

/** All live checks: what the page showed, the streak, and each transaction read back from the chain. */
export async function liveChecks(
  evm: EvmReader,
  book: BookReader,
  record: LiveRecord,
  contracts: readonly string[],
  revertCodespace: string,
): Promise<Check[]> {
  const onChain = await Promise.all(record.runs.map((r) => chainCheck(evm, book, contracts, r, revertCodespace)));
  return [...recordChecks(record), streakCheck(record, record.retireStreak), ...onChain.flat()];
}
