import app from "../../config/app.json";
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
  refreshSeconds: number;
  agreeCheckLatest: number;
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
  refreshSeconds: app.web.refreshSeconds,
  agreeCheckLatest: app.web.agreeCheckLatest,
  defaultLocale: app.web.defaultLocale,
  locales: app.web.locales,
  simulatedMeters: meter.simulated,
  systems: meter.systems,
};
