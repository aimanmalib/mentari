import type { SiteConfig } from "../config.js";

/** Links into the public QoreChain explorer. The URL shapes live in config/app.json `web.explorer`. */
export interface Explorer {
  tx(hash: string): string;
  block(height: number): string;
  address(address: string): string;
}

const fill = (template: string, name: string, value: string) => template.replace(`{${name}}`, encodeURIComponent(value));

export function explorer(templates: SiteConfig["explorer"]): Explorer {
  return {
    tx: (hash) => fill(templates.tx, "hash", hash),
    block: (height) => fill(templates.block, "height", String(height)),
    address: (address) => fill(templates.address, "address", address),
  };
}
