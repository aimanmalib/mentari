import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  network: {
    chainId: string;
    evmChainId: number;
    evmRpc: string;
    rest: string;
    rpc: string;
    evmDecimals: number;
    symbol: string;
  };
  /** Account index (as a string) -> role. Only these indices are ever derived. */
  accounts: Record<string, string>;
  contracts: { mentari: string; atomicityProbe: string };
}

const APP_JSON = fileURLToPath(new URL("../../config/app.json", import.meta.url));

export function loadAppConfig(path: string = APP_JSON): AppConfig {
  return JSON.parse(readFileSync(path, "utf8")) as AppConfig;
}

/** Sorted numeric account indices declared in config/app.json. */
export function accountIndices(cfg: AppConfig): number[] {
  return Object.keys(cfg.accounts)
    .map((k) => {
      const n = Number(k);
      if (!Number.isInteger(n) || n < 0) throw new Error(`config/app.json accounts: bad index "${k}"`);
      return n;
    })
    .sort((a, b) => a - b);
}
