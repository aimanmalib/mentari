import type { Receipt } from "./types.js";

export type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** base64 of a UTF-8 string, as the CosmWasm smart-query path expects. */
export function queryPath(lcdBase: string, contract: string, query: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(query));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `${lcdBase}/cosmwasm/wasm/v1/contract/${contract}/smart/${encodeURIComponent(btoa(bin))}`;
}

function isReceipt(v: unknown): v is Receipt {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === "number" && typeof r.sender === "string" && typeof r.note === "string" && typeof r.height === "number";
}

/** Reads the receipts book through the site's read-only `/lcd` proxy. */
export class ReceiptsBook {
  constructor(
    private readonly lcdBase: string,
    private readonly contract: string,
    private readonly fetchFn: Fetch,
  ) {}

  async #smart(query: unknown): Promise<{ status: number; data: unknown; message: string }> {
    const res = await this.fetchFn(queryPath(this.lcdBase, this.contract, query));
    let body: { data?: unknown; message?: unknown } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // A non-JSON error page: keep the status only.
    }
    const message = typeof body.message === "string" ? body.message : "";
    return { status: res.status, data: res.ok ? (body.data ?? null) : null, message };
  }

  /** Total receipts in the book, from every sender. */
  async count(): Promise<number> {
    const { status, data } = await this.#smart({ count: {} });
    const count = (data as { count?: unknown } | null)?.count;
    if (typeof count !== "number") throw new Error(`receipts count unreadable (HTTP ${status})`);
    return count;
  }

  /**
   * One receipt, or null when the book has no receipt with this id. The chain answers a missing key with
   * HTTP 500 and "not found" in the message; any other failure throws so the page shows "could not check".
   */
  async receipt(id: number): Promise<Receipt | null> {
    const { status, data, message } = await this.#smart({ receipt: { id } });
    if (status === 200) return isReceipt(data) ? data : null;
    if (/\bnot found\b/.test(message)) return null;
    throw new Error(`receipts book unavailable (HTTP ${status})`);
  }
}
