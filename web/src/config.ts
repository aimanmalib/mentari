import app from "../../config/app.json";
import limits from "../../config/limits.json";
import meter from "../../config/meter.json";

/** Everything the site needs from config/. Pages read this object; nothing here is hard-coded in components. */
export interface SiteConfig {
  evmRpc: string;
  evmChainId: number;
  lcdBase: string;
  receiptsBook: string;
  bridge: string;
  nativePrefix: string;
  contract: string;
  probe: string;
  /** EVM block to start searching for `Retired` events; 0 means from the first block. */
  deployBlock: number;
  /** `Retired` log search: blocks per `eth_getLogs` call and the most calls per lookup (config/limits.json `evm`). */
  logWindowBlocks: number;
  logMaxWindows: number;
  refreshSeconds: number;
  agreeCheckLatest: number;
  retirementsPageSize: number;
  demoApi: string;
  /** Watt-hours the "Retire now" button retires (config/limits.json `demo.retireWh`). */
  demoRetireWh: number;
  /** Watt-hours the demo account sends to a visitor's wallet (config/limits.json `demo.grantWh`). */
  demoGrantWh: number;
  /** Wallet path: memo on wallet retirements, and the wallet dialog's locale for each site locale. */
  wallet: { memo: string; modalLocales: Record<string, string> };
  /**
   * `tx` takes a Cosmos hash; `evmTx` is this server's redirect for an EVM hash (decision 0033) and `receiptTx` its
   * redirect for the transaction that wrote a receipt (decision 0034).
   */
  explorer: { tx: string; evmTx: string; receiptTx: string; block: string; address: string };
  /** Footer links: the public repository and the slides PDF. */
  links: { source: string; slides: string };
  defaultLocale: string;
  locales: string[];
  simulatedMeters: boolean;
  systems: { id: number; label: string }[];
}

export const siteConfig: SiteConfig = {
  evmRpc: app.network.evmRpc,
  evmChainId: app.network.evmChainId,
  lcdBase: app.web.lcdBase,
  receiptsBook: app.native.receiptsBook,
  bridge: app.network.crossVmBridge,
  nativePrefix: app.web.nativeAddressPrefix,
  contract: app.contracts.mentari,
  probe: app.contracts.atomicityProbe,
  deployBlock: app.contracts.mentariDeployBlock,
  logWindowBlocks: limits.evm.logWindowBlocks,
  logMaxWindows: limits.evm.logMaxWindows,
  refreshSeconds: app.web.refreshSeconds,
  agreeCheckLatest: app.web.agreeCheckLatest,
  retirementsPageSize: app.web.retirementsPageSize,
  demoApi: app.web.demoApi,
  demoRetireWh: limits.demo.retireWh,
  demoGrantWh: limits.demo.grantWh,
  wallet: app.web.wallet,
  explorer: app.web.explorer,
  links: app.web.links,
  defaultLocale: app.web.defaultLocale,
  locales: app.web.locales,
  simulatedMeters: meter.simulated,
  systems: meter.systems,
};
