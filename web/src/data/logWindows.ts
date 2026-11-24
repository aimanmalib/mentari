/**
 * Public QoreChain EVM nodes refuse `eth_getLogs` when `toBlock - fromBlock` exceeds a fixed distance
 * (testnet: 10000). This walks back from the newest block in windows that stay inside that limit, and stops
 * as soon as every wanted retirement is found or the contract's deploy block is reached (decision 0034).
 */
export interface LogWindowOptions {
  /** Blocks per request, both ends included; the request spans `windowBlocks - 1`. */
  windowBlocks: number;
  /** Upper bound on requests for one lookup, so an old retirement cannot cost an unbounded number of calls. */
  maxWindows: number;
  /** First block worth searching (the contract's deploy block). */
  fromBlock: bigint;
}

/** One `Retired` log as the search needs it: the retirement number and the transaction that emitted it. */
export interface FoundLog {
  n: number;
  txHash: string;
}

export type GetLogsWindow = (fromBlock: bigint, toBlock: bigint) => Promise<FoundLog[]>;

export async function findInWindows(
  ns: number[],
  latestBlock: bigint,
  getLogs: GetLogsWindow,
  opts: LogWindowOptions,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const wanted = new Set(ns);
  if (wanted.size === 0) return out;
  const span = BigInt(Math.max(1, Math.floor(opts.windowBlocks)));
  let to = latestBlock;
  for (let i = 0; i < opts.maxWindows && to >= opts.fromBlock && out.size < wanted.size; i++) {
    const from = to - span + 1n > opts.fromBlock ? to - span + 1n : opts.fromBlock;
    for (const log of await getLogs(from, to)) {
      if (wanted.has(log.n) && !out.has(log.n)) out.set(log.n, log.txHash);
    }
    to = from - 1n;
  }
  return out;
}
