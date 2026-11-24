import { evmToNative } from "./address.js";
import { checkPair, latestNumbers, summarise } from "./agree.js";
import type { ReceiptsBook } from "./native.js";
import type { Receipt, RegistrySnapshot, Retirement, SystemInfo, Totals } from "./types.js";

/** What the registry needs from the EVM side. The live version wraps viem; tests pass a plain object. */
export interface MentariReader {
  totals(): Promise<Totals>;
  retirementsCount(): Promise<number>;
  retirement(n: number): Promise<Retirement>;
  /** EVM transaction hash of each retirement number found in the `Retired` events. Missing numbers are left out. */
  retiredTxs(ns: number[]): Promise<Map<number, string>>;
  /** Null when the contract does not know this system yet. */
  system(id: number, label: string): Promise<SystemInfo | null>;
}

export interface RegistryOptions {
  contract: string;
  nativePrefix: string;
  systems: { id: number; label: string }[];
  checkLatest: number;
  now?: () => number;
}

/** Reads totals and systems from the contract, then checks the latest retirements against their Native receipts. */
export async function readRegistry(
  evm: MentariReader,
  book: Pick<ReceiptsBook, "receipt">,
  opts: RegistryOptions,
): Promise<RegistrySnapshot> {
  const contractNative = evmToNative(opts.contract, opts.nativePrefix);
  const [totals, count, systems] = await Promise.all([
    evm.totals(),
    evm.retirementsCount(),
    Promise.all(opts.systems.map((s) => evm.system(s.id, s.label))),
  ]);
  const numbers = latestNumbers(count, opts.checkLatest);
  const pairs = await Promise.all(
    numbers.map(async (n) => {
      const r = await evm.retirement(n);
      return checkPair(r, await book.receipt(r.receiptId), contractNative);
    }),
  );
  return {
    source: "live",
    contract: opts.contract,
    contractNative,
    totals,
    retirementsCount: count,
    systems: systems.filter((s): s is SystemInfo => s !== null),
    pairs,
    agreement: summarise(pairs, count),
    readAt: (opts.now ?? Date.now)(),
  };
}

/** Fixture data in the shape of the testnet evidence, for local development without the chain. */
export interface SampleData {
  contract: string;
  totals: { minted: string; retired: string; supply: string };
  systems: { id: number; meter: string; producer: string; capacityW: number; firstDay: number; maxWh: string }[];
  retirements: { n: number; holder: string; wh: string; receiptId: number; timestamp: number; evmTx: string }[];
  receipts: Receipt[];
  /** Recorded demo cases, shaped like `evidence/testnet.json`. */
  cases: unknown[];
}

/** Turns sample data into the same readers the live page uses, so sample mode runs the real checks. */
export function sampleReaders(sample: SampleData): { evm: MentariReader; book: Pick<ReceiptsBook, "receipt"> } {
  const retirements = sample.retirements.map(({ evmTx: _tx, ...r }) => ({ ...r, wh: BigInt(r.wh) }));
  const txs = new Map(sample.retirements.map((r) => [r.n, r.evmTx]));
  const evm: MentariReader = {
    totals: async () => ({
      minted: BigInt(sample.totals.minted),
      retired: BigInt(sample.totals.retired),
      supply: BigInt(sample.totals.supply),
    }),
    retirementsCount: async () => retirements.length,
    retirement: async (n) => {
      const r = retirements.find((x) => x.n === n);
      if (!r) throw new Error(`no retirement ${n}`);
      return r;
    },
    retiredTxs: async (ns) => new Map(ns.flatMap((n) => (txs.has(n) ? [[n, txs.get(n)!] as const] : []))),
    system: async (id, label) => {
      const s = sample.systems.find((x) => x.id === id);
      return s ? { ...s, label, maxWh: BigInt(s.maxWh) } : null;
    },
  };
  const book = { receipt: async (id: number) => sample.receipts.find((r) => r.id === id) ?? null };
  return { evm, book };
}
