import { json, methodNotAllowed, notFound, type Reply } from "./http.js";
import type { LcdProxy } from "./lcd.js";

/**
 * `/go/tx/<hash>` sends a visitor to the explorer page of one transaction (decision 0033).
 * The explorer's transaction page only takes the Cosmos hash. A Cosmos hash is passed straight on; an EVM hash is
 * first looked up on the Native REST API, which indexes every EVM transaction by its `ethereumTxHash`.
 */
export const EXPLORER_MOUNT = "/go/tx";

const COSMOS_HASH = /^[0-9A-Fa-f]{64}$/;
const EVM_HASH = /^0x[0-9A-Fa-f]{64}$/;

export interface ExplorerConfig {
  /** Explorer transaction URL with a `{hash}` placeholder (config/app.json `web.explorer.tx`). */
  txTemplate: string;
  /** Native REST origin; the only host the lookup reaches. */
  restOrigin: string;
  /** How long a browser may keep a redirect. A hash never maps to another transaction. */
  cacheSeconds: number;
}

/** The REST query that finds the Native transaction carrying one EVM transaction. */
export function lookupUrl(origin: string, evmHash: string): URL {
  const url = new URL("/cosmos/tx/v1beta1/txs", origin);
  url.searchParams.set("query", `ethereum_tx.ethereumTxHash='${evmHash.toLowerCase()}'`);
  url.searchParams.set("pagination.limit", "1");
  return url;
}

/** The Cosmos hash in a REST `txs` reply, or `null` when the reply holds none. */
export function cosmosHashFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const list = (body as { tx_responses?: unknown }).tx_responses;
  if (!Array.isArray(list) || list.length === 0) return null;
  const hash: unknown = (list[0] as { txhash?: unknown } | null)?.txhash;
  return typeof hash === "string" && COSMOS_HASH.test(hash) ? hash.toUpperCase() : null;
}

export class ExplorerLinks {
  readonly #cfg: ExplorerConfig;
  readonly #lcd: LcdProxy;

  constructor(cfg: ExplorerConfig, lcd: LcdProxy) {
    this.#cfg = cfg;
    this.#lcd = lcd;
  }

  async handle(method: string, rawUrl: string): Promise<Reply> {
    if (method !== "GET" && method !== "HEAD") return methodNotAllowed("GET, HEAD");
    const rest = rawUrl.slice(EXPLORER_MOUNT.length);
    const q = rest.indexOf("?");
    const hash = (q === -1 ? rest : rest.slice(0, q)).replace(/^\//, "");
    if (COSMOS_HASH.test(hash)) return this.#redirect(hash.toUpperCase());
    if (!EVM_HASH.test(hash)) return notFound();

    let found: string | null;
    try {
      const entry = await this.#lcd.get(lookupUrl(this.#cfg.restOrigin, hash));
      if (entry.status >= 500) return json(502, { error: "upstream unavailable" });
      found = entry.status === 200 ? cosmosHashFrom(JSON.parse(entry.body.toString("utf8"))) : null;
    } catch {
      return json(502, { error: "upstream unavailable" });
    }
    return found ? this.#redirect(found) : json(404, { error: "transaction not found on the testnet" });
  }

  #redirect(cosmosHash: string): Reply {
    return {
      status: 302,
      headers: {
        location: this.#cfg.txTemplate.replace("{hash}", cosmosHash),
        "cache-control": `public, max-age=${this.#cfg.cacheSeconds}`,
      },
      body: "",
    };
  }
}
