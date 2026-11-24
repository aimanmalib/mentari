import { getAddress, toFunctionSelector } from "viem";
import { json, methodNotAllowed, type Reply } from "./http.js";
import type { LcdProxy } from "./lcd.js";

/**
 * `GET /api/readings` lists the newest meter readings the chain accepted, as the raw `attest` calldata of each
 * Native-lane `MsgCrossVMCall` (decision 0037). The browser decodes it, rebuilds the signed message and checks the
 * ML-DSA-87 signature itself. The server only finds the transactions; it never says whether a signature is valid.
 */
export const READINGS_MOUNT = "/api/readings";

/** `Mentari.attest(uint32,uint32,uint64,bytes)`; the calldata of every reading starts with it. */
export const ATTEST_SELECTOR = toFunctionSelector("attest(uint32,uint32,uint64,bytes)");

const CROSS_VM_CALL = "/qorechain.crossvm.v1.MsgCrossVMCall";
const COSMOS_HASH = /^[0-9A-Fa-f]{64}$/;

export interface ReadingsConfig {
  /** Native REST origin; the only host the lookup reaches. */
  restOrigin: string;
  /** The Mentari contract (EVM address); empty before it is deployed, and then the list is empty. */
  contract: string;
  /** Readings to return at most (config/limits.json `readings.max`). */
  max: number;
  /** Transactions per REST page and the most pages one refresh reads. */
  pageSize: number;
  maxPages: number;
  /** How long the list is kept before the chain is asked again. */
  cacheSeconds: number;
}

/** One accepted reading: the Cosmos transaction that carried it and its `attest` calldata, hex with `0x`. */
export interface ReadingTx {
  cosmosTx: string;
  height: number;
  calldata: string;
}

/**
 * The REST query for the Native-lane calls into the contract, newest first. The chain indexes `target_contract` as
 * the sender typed it, which is the checksummed form, and matches it case-sensitively: a lower-case address finds
 * nothing (measured 2026-11-24), so the address is checksummed here.
 */
export function readingsPageUrl(origin: string, contract: string, page: number, pageSize: number): URL {
  const url = new URL("/cosmos/tx/v1beta1/txs", origin);
  url.searchParams.set("query", `crossvm_request.target_contract='${getAddress(contract)}'`);
  url.searchParams.set("order_by", "ORDER_BY_DESC");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(pageSize));
  return url;
}

/** The accepted `attest` calls in one REST `txs` reply, in reply order. Anything else is skipped. */
export function readingsFrom(body: unknown, contract: string): ReadingTx[] {
  if (typeof body !== "object" || body === null) return [];
  const { txs, tx_responses: responses } = body as { txs?: unknown; tx_responses?: unknown };
  if (!Array.isArray(txs) || !Array.isArray(responses)) return [];
  const out: ReadingTx[] = [];
  responses.forEach((r: unknown, i) => {
    const resp = r as { txhash?: unknown; height?: unknown; code?: unknown } | null;
    if (!resp || resp.code !== 0 || typeof resp.txhash !== "string" || !COSMOS_HASH.test(resp.txhash)) return;
    const height = Number(resp.height);
    if (!Number.isSafeInteger(height) || height <= 0) return;
    const messages = (txs[i] as { body?: { messages?: unknown } } | null)?.body?.messages;
    if (!Array.isArray(messages)) return;
    for (const m of messages as Record<string, unknown>[]) {
      if (m?.["@type"] !== CROSS_VM_CALL || typeof m.payload !== "string") continue;
      if (typeof m.target_contract !== "string" || m.target_contract.toLowerCase() !== contract.toLowerCase()) continue;
      const calldata = `0x${Buffer.from(m.payload, "base64").toString("hex")}`;
      if (calldata.startsWith(ATTEST_SELECTOR)) out.push({ cosmosTx: resp.txhash.toUpperCase(), height, calldata });
    }
  });
  return out;
}

export class Readings {
  readonly #cfg: ReadingsConfig;
  readonly #lcd: LcdProxy;
  readonly #now: () => number;
  #cached: { expires: number; value: { readings: ReadingTx[]; complete: boolean } } | null = null;

  constructor(cfg: ReadingsConfig, lcd: LcdProxy, now: () => number = Date.now) {
    this.#cfg = cfg;
    this.#lcd = lcd;
    this.#now = now;
  }

  async handle(method: string): Promise<Reply> {
    if (method !== "GET" && method !== "HEAD") return methodNotAllowed("GET, HEAD");
    try {
      const value = await this.#list();
      return json(200, value, { "cache-control": `public, max-age=${this.#cfg.cacheSeconds}` });
    } catch {
      return json(502, { error: "upstream unavailable" });
    }
  }

  /** Reads pages newest first until `max` readings are found, the chain has no more, or `maxPages` is reached. */
  async #list(): Promise<{ readings: ReadingTx[]; complete: boolean }> {
    if (this.#cached && this.#cached.expires > this.#now()) return this.#cached.value;
    const { restOrigin, contract, max, pageSize, maxPages } = this.#cfg;
    const readings: ReadingTx[] = [];
    let complete = contract === "";
    for (let page = 1; !complete && page <= maxPages && readings.length < max; page++) {
      const entry = await this.#lcd.get(readingsPageUrl(restOrigin, contract, page, pageSize));
      if (entry.status !== 200) throw new Error(`readings page ${page}: HTTP ${entry.status}`);
      const body: unknown = JSON.parse(entry.body.toString("utf8"));
      readings.push(...readingsFrom(body, contract));
      const total = Number((body as { total?: unknown }).total);
      if (!Number.isFinite(total) || page * pageSize >= total) {
        complete = true;
        break;
      }
    }
    const value = { readings: readings.slice(0, max), complete: complete || readings.length >= max };
    this.#cached = { expires: this.#now() + this.#cfg.cacheSeconds * 1000, value };
    return value;
  }
}
