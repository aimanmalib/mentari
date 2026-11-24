import type { SiteConfig } from "../config.js";
import sample from "../../fixtures/sample.json";
import { ReceiptsBook } from "./native.js";
import { readRegistry, sampleReaders, type MentariReader, type SampleData } from "./registry.js";
import type { RegistrySnapshot } from "./types.js";

export type DataMode = "live" | "sample";

/**
 * Live once `contracts.mentari` is set in config/app.json; sample data before that, or when the build sets
 * `VITE_MENTARI_DATA=sample` for local work. The page always says which one it shows.
 */
export function dataMode(cfg: Pick<SiteConfig, "contract">, forced: string | undefined): DataMode {
  if (forced === "sample") return "sample";
  return cfg.contract ? "live" : "sample";
}

/** The readers every page uses, for the chosen mode. */
export interface Readers {
  source: DataMode;
  contract: string;
  evm: MentariReader;
  book: Pick<ReceiptsBook, "receipt">;
  /** Status of an EVM transaction; null in sample mode, where the hashes are made up. */
  txStatus: ((hash: string) => Promise<"success" | "reverted" | null>) | null;
}

export const sampleData = sample as SampleData;

export async function readers(cfg: SiteConfig, mode: DataMode): Promise<Readers> {
  if (mode === "sample") {
    const { evm, book } = sampleReaders(sampleData);
    return { source: "sample", contract: sampleData.contract, evm, book, txStatus: null };
  }
  // viem is only needed for live reads; loading it on demand keeps the first page light.
  const { mentariReader, txStatusReader } = await import("./evm.js");
  return {
    source: "live",
    contract: cfg.contract,
    evm: mentariReader(cfg.evmRpc, cfg.contract, {
      deployBlock: cfg.deployBlock,
      windowBlocks: cfg.logWindowBlocks,
      maxWindows: cfg.logMaxWindows,
    }),
    book: new ReceiptsBook(cfg.lcdBase, cfg.receiptsBook, (url, init) => fetch(url, init)),
    txStatus: txStatusReader(cfg.evmRpc),
  };
}

export async function loadRegistry(cfg: SiteConfig, mode: DataMode): Promise<RegistrySnapshot> {
  const r = await readers(cfg, mode);
  const snap = await readRegistry(r.evm, r.book, {
    contract: r.contract,
    nativePrefix: cfg.nativePrefix,
    systems: cfg.systems,
    checkLatest: cfg.agreeCheckLatest,
  });
  return { ...snap, source: r.source };
}
