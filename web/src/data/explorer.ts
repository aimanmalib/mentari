import type { SiteConfig } from "../config.js";

/** Links into the public QoreChain explorer. The URL shapes live in config/app.json `web.explorer`. */
export interface Explorer {
  tx(hash: string): string;
  /** The Native transaction that wrote receipt `id`, through this server's `/go/receipt/` route (decision 0034). */
  receiptTx(id: number): string;
  block(height: number): string;
  address(address: string): string;
}

const fill = (template: string, name: string, value: string) => template.replace(`{${name}}`, encodeURIComponent(value));

/**
 * The explorer's transaction page takes the Cosmos hash only. An EVM hash (`0x…`) goes through this server's
 * `/go/tx/` route, which looks up the Cosmos hash and redirects (decision 0033).
 */
export function explorer(templates: SiteConfig["explorer"]): Explorer {
  return {
    tx: (hash) => fill(/^0x/i.test(hash) ? templates.evmTx : templates.tx, "hash", hash),
    receiptTx: (id) => fill(templates.receiptTx, "id", String(id)),
    block: (height) => fill(templates.block, "height", String(height)),
    address: (address) => fill(templates.address, "address", address),
  };
}
