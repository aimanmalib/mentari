import { json, methodNotAllowed, notFound, type Reply } from "./http.js";
import type { LcdProxy } from "./lcd.js";

/**
 * `/go/tx/<hash>` sends a visitor to the explorer page of one transaction (decision 0033).
 * The explorer's transaction page only takes the Cosmos hash. A Cosmos hash is passed straight on; an EVM hash is
 * first looked up on the Native REST API, which indexes every EVM transaction by its `ethereumTxHash`.
 */
export const EXPLORER_MOUNT = "/go/tx";
/**
 * `/go/receipt/<id>` sends a visitor to the Native transaction that wrote one receipt in the receipts book
 * (decision 0034). Retirements sent from the Native lane have no EVM transaction to link, but every one has a receipt.
 */
export const RECEIPT_MOUNT = "/go/receipt";

const COSMOS_HASH = /^[0-9A-Fa-f]{64}$/;
const EVM_HASH = /^0x[0-9A-Fa-f]{64}$/;
/** Receipt ids are u64 in the receipts book; ids start at 1. */
const RECEIPT_ID = /^[1-9][0-9]{0,19}$/;

export interface ExplorerConfig {
  /** Explorer transaction URL with a `{hash}` placeholder (config/app.json `web.explorer.tx`). */
  txTemplate: string;
  /** Native REST origin; the only host the lookup reaches. */
  restOrigin: string;
  /** How long a browser may keep a redirect. A hash never maps to another transaction. */
  cacheSeconds: number;
  /** Receipts book contract address (config/app.json `native.receiptsBook`). */
  receiptsBook: string;
}

/** The REST query that finds the Native transaction carrying one EVM transaction. */
export function lookupUrl(origin: string, evmHash: string): URL {
  const url = new URL("/cosmos/tx/v1beta1/txs", origin);
  url.searchParams.set("query", `ethereum_tx.ethereumTxHash='${evmHash.toLowerCase()}'`);
  url.searchParams.set("pagination.limit", "1");
  return url;
}

/** The REST query that finds the Native transaction whose `record` call wrote receipt `id` in the book. */
export function receiptLookupUrl(origin: string, book: string, id: string): URL {
  const url = new URL("/cosmos/tx/v1beta1/txs", origin);
  url.searchParams.set("query", `wasm._contract_address='${book}' AND wasm.action='record' AND wasm.id='${id}'`);
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
    const hash = lastSegment(rawUrl, EXPLORER_MOUNT);
    if (COSMOS_HASH.test(hash)) return this.#redirect(hash.toUpperCase());
    if (!EVM_HASH.test(hash)) return notFound();
    return this.#lookup(lookupUrl(this.#cfg.restOrigin, hash));
  }

  async handleReceipt(method: string, rawUrl: string): Promise<Reply> {
    if (method !== "GET" && method !== "HEAD") return methodNotAllowed("GET, HEAD");
    const id = lastSegment(rawUrl, RECEIPT_MOUNT);
    if (!RECEIPT_ID.test(id) || BigInt(id) > 0xffff_ffff_ffff_ffffn) return notFound();
    return this.#lookup(receiptLookupUrl(this.#cfg.restOrigin, this.#cfg.receiptsBook, id));
  }

  async #lookup(url: URL): Promise<Reply> {
    let found: string | null;
    try {
      const entry = await this.#lcd.get(url);
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

/** The path segment after a mount, without query string or leading slash. */
function lastSegment(rawUrl: string, mount: string): string {
  const rest = rawUrl.slice(mount.length);
  const q = rest.indexOf("?");
  return (q === -1 ? rest : rest.slice(0, q)).replace(/^\//, "");
}
