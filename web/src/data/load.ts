import type { SiteConfig } from "../config.js";
import sample from "../../fixtures/sample.json";
import { ReceiptsBook } from "./native.js";
import { readRegistry, sampleReaders, type SampleData } from "./registry.js";
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

export async function loadRegistry(cfg: SiteConfig, mode: DataMode): Promise<RegistrySnapshot> {
  const systems = cfg.systems;
  if (mode === "sample") {
    const data = sample as SampleData;
    const { evm, book } = sampleReaders(data);
    const snap = await readRegistry(evm, book, {
      contract: data.contract,
      nativePrefix: cfg.nativePrefix,
      systems,
      checkLatest: cfg.agreeCheckLatest,
    });
    return { ...snap, source: "sample" };
  }
  // viem is only needed for live reads; loading it on demand keeps the first page light.
  const { mentariReader } = await import("./evm.js");
  const evm = mentariReader(cfg.evmRpc, cfg.contract);
  const book = new ReceiptsBook(cfg.lcdBase, cfg.receiptsBook, (url, init) => fetch(url, init));
  return readRegistry(evm, book, {
    contract: cfg.contract,
    nativePrefix: cfg.nativePrefix,
    systems,
    checkLatest: cfg.agreeCheckLatest,
  });
}
