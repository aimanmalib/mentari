import type { Fetch } from "./lane.js";

/**
 * Public REST reads the testnet cases record: the receipts book's count at a given block height, one receipt by id,
 * and the Cosmos transaction that carries an EVM transaction. No keys; the same reads anyone can repeat.
 */

export interface Receipt {
  id: number;
  sender: string;
  note: string;
  height: number;
}

export interface BookReader {
  /** The book's receipt count as stored at the end of block `height`. */
  countAt(height: number): Promise<number>;
  receipt(id: number): Promise<Receipt>;
  /** Hash of the Cosmos transaction that carried the EVM transaction, or null when the node does not find it. */
  cosmosTxOf(evmHash: string): Promise<string | null>;
}

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});

export function bookReader(opts: { rest: string; book: string; fetch?: Fetch }): BookReader {
  const base = opts.rest.replace(/\/+$/, "");
  const f: Fetch = opts.fetch ?? fetch;

  const get = async (path: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> => {
    const res = await f(`${base}${path}`, { headers: { accept: "application/json", ...headers } });
    const body = obj(await res.json().catch(() => undefined));
    if (res.status !== 200) throw new Error(`GET ${path.split("?")[0]}: HTTP ${res.status}`);
    return body;
  };
  const smart = async (query: unknown, headers?: Record<string, string>): Promise<Record<string, unknown>> => {
    const q = encodeURIComponent(Buffer.from(JSON.stringify(query)).toString("base64"));
    return obj((await get(`/cosmwasm/wasm/v1/contract/${opts.book}/smart/${q}`, headers)).data);
  };

  return {
    async countAt(height) {
      const { count } = await smart({ count: {} }, { "x-cosmos-block-height": String(height) });
      if (typeof count !== "number") throw new Error(`receipts count at ${height} unreadable`);
      return count;
    },
    async receipt(id) {
      const r = await smart({ receipt: { id } });
      if (typeof r.id !== "number" || typeof r.sender !== "string" || typeof r.note !== "string")
        throw new Error(`receipt ${id} unreadable`);
      return { id: r.id, sender: r.sender, note: r.note, height: Number(r.height) };
    },
    async cosmosTxOf(evmHash) {
      const query = encodeURIComponent(`ethereum_tx.ethereumTxHash='${evmHash}'`);
      const body = await get(`/cosmos/tx/v1beta1/txs?query=${query}`);
      const list = Array.isArray(body.tx_responses) ? body.tx_responses : [];
      const hash = obj(list[0]).txhash;
      return typeof hash === "string" ? hash : null;
    },
  };
}
