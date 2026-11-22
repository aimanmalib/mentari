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
  refreshSeconds: number;
  agreeCheckLatest: number;
  retirementsPageSize: number;
  demoApi: string;
  /** Watt-hours the "Retire now" button retires (config/limits.json `demo.retireWh`). */
  demoRetireWh: number;
  explorer: { tx: string; block: string; address: string };
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
  refreshSeconds: app.web.refreshSeconds,
  agreeCheckLatest: app.web.agreeCheckLatest,
  retirementsPageSize: app.web.retirementsPageSize,
  demoApi: app.web.demoApi,
  demoRetireWh: limits.demo.retireWh,
  explorer: app.web.explorer,
  defaultLocale: app.web.defaultLocale,
  locales: app.web.locales,
  simulatedMeters: meter.simulated,
  systems: meter.systems,
};
