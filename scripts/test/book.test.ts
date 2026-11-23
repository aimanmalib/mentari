import { describe, expect, it } from "vitest";
import { bookReader } from "../src/book.js";
import type { Fetch } from "../src/lane.js";

/** A fetch that answers from a table and remembers each request. */
function fakeFetch(answers: Record<string, { status: number; body: unknown }>) {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url, headers: init?.headers ?? {} });
    const key = Object.keys(answers).find((k) => url.includes(k));
    const a = key ? answers[key]! : { status: 404, body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status });
  }) as unknown as Fetch;
  return { f, seen };
}

const q = (query: unknown) => encodeURIComponent(Buffer.from(JSON.stringify(query)).toString("base64"));

describe("bookReader", () => {
  it("reads the count at a block height through the height header", async () => {
    const { f, seen } = fakeFetch({ [q({ count: {} })]: { status: 200, body: { data: { count: 7 } } } });
    const book = bookReader({ rest: "https://rest.example/", book: "qor1book", fetch: f });
    expect(await book.countAt(123)).toBe(7);
    expect(seen[0]!.url).toBe(`https://rest.example/cosmwasm/wasm/v1/contract/qor1book/smart/${q({ count: {} })}`);
    expect(seen[0]!.headers["x-cosmos-block-height"]).toBe("123");
  });

  it("reads one receipt and refuses a malformed one", async () => {
    const good = { data: { id: 8, sender: "qor1mentari", note: "MTR1 n=1", height: 99 } };
    const { f } = fakeFetch({
      [q({ receipt: { id: 8 } })]: { status: 200, body: good },
      [q({ receipt: { id: 9 } })]: { status: 200, body: { data: { id: 9 } } },
      [q({ receipt: { id: 10 } })]: { status: 500, body: { message: "not found" } },
    });
    const book = bookReader({ rest: "https://rest.example", book: "qor1book", fetch: f });
    expect(await book.receipt(8)).toEqual({ id: 8, sender: "qor1mentari", note: "MTR1 n=1", height: 99 });
    await expect(book.receipt(9)).rejects.toThrow(/receipt 9 unreadable/);
    await expect(book.receipt(10)).rejects.toThrow(/HTTP 500/);
  });

  it("finds the Cosmos transaction of an EVM hash, or null", async () => {
    const hash = "0xabc";
    const query = encodeURIComponent(`ethereum_tx.ethereumTxHash='${hash}'`);
    const { f, seen } = fakeFetch({
      [query]: { status: 200, body: { tx_responses: [{ txhash: "5E6C" }] } },
      "ethereumTxHash%3D'0xdef'": { status: 200, body: { tx_responses: [] } },
    });
    const book = bookReader({ rest: "https://rest.example", book: "qor1book", fetch: f });
    expect(await book.cosmosTxOf(hash)).toBe("5E6C");
    expect(seen[0]!.url).toBe(`https://rest.example/cosmos/tx/v1beta1/txs?query=${query}`);
    expect(await book.cosmosTxOf("0xdef")).toBeNull();
  });

  it("reads a Cosmos transaction's code and block by hash, or null when the node does not have it", async () => {
    const { f, seen } = fakeFetch({
      "/txs/AA": { status: 200, body: { tx_response: { code: 14, height: "12" } } },
      "/txs/BB": { status: 200, body: { tx_response: { height: "13" } } },
    });
    const book = bookReader({ rest: "https://rest.example", book: "qor1book", fetch: f });
    expect(await book.cosmosTx("AA")).toEqual({ code: 14, height: 12 });
    expect(seen[0]!.url).toBe("https://rest.example/cosmos/tx/v1beta1/txs/AA");
    expect(await book.cosmosTx("BB")).toEqual({ code: 0, height: 13 });
    expect(await book.cosmosTx("CC")).toBeNull();
  });
});
