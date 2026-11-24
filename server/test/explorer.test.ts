import { describe, expect, it } from "vitest";
import { cosmosHashFrom, ExplorerLinks, lookupUrl, receiptLookupUrl } from "../src/explorer.js";
import { LcdProxy } from "../src/lcd.js";
import { fakeFetch, okJson, ORIGIN, testConfig } from "./fixture.js";

const EVM = `0x${"Ab".repeat(32)}`;
const COSMOS = "5654336FDCC86E817D25DE3391FE76FFDAAC8CE92785C785E0AA276369E8A618";
const TEMPLATE = "https://explorer.example.test/tx/{hash}";
const BOOK = "qor1bookbookbookbookbookbookbookbookbookbookbookbookbookbookbo";

function links(reply: (url: string) => Response | Promise<Response>) {
  const f = fakeFetch(reply);
  const cfg = testConfig({ maxBodyBytes: 100_000 });
  const x = new ExplorerLinks({ txTemplate: TEMPLATE, restOrigin: ORIGIN, cacheSeconds: 600, receiptsBook: BOOK }, new LcdProxy(cfg, f.fn));
  return { x, calls: f.calls };
}

const found = (hash: string) =>
  okJson({
    txs: [{}],
    tx_responses: [{ txhash: hash, height: "10609362" }],
    total: "1",
  });

describe("lookupUrl", () => {
  it("asks the fixed origin for the transaction carrying the EVM hash, in lower case", () => {
    const u = lookupUrl(ORIGIN, EVM);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe("/cosmos/tx/v1beta1/txs");
    expect(u.searchParams.get("query")).toBe(`ethereum_tx.ethereumTxHash='${EVM.toLowerCase()}'`);
    expect(u.searchParams.get("pagination.limit")).toBe("1");
  });
});

describe("cosmosHashFrom", () => {
  it("reads the first txhash and refuses anything that is not a Cosmos hash", () => {
    expect(cosmosHashFrom({ tx_responses: [{ txhash: COSMOS.toLowerCase() }] })).toBe(COSMOS);
    expect(cosmosHashFrom({ tx_responses: [] })).toBeNull();
    expect(cosmosHashFrom({ tx_responses: [{ txhash: "javascript:alert(1)" }] })).toBeNull();
    expect(cosmosHashFrom(null)).toBeNull();
    expect(cosmosHashFrom({})).toBeNull();
  });
});

describe("ExplorerLinks", () => {
  it("passes a Cosmos hash straight to the explorer without a lookup", async () => {
    const { x, calls } = links(() => found(COSMOS));
    const r = await x.handle("GET", `/go/tx/${COSMOS.toLowerCase()}`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`https://explorer.example.test/tx/${COSMOS}`);
    expect(r.headers["cache-control"]).toBe("public, max-age=600");
    expect(calls).toEqual([]);
  });

  it("looks an EVM hash up and redirects to the Cosmos hash that carries it", async () => {
    const { x, calls } = links(() => found(COSMOS));
    const r = await x.handle("GET", `/go/tx/${EVM}`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`https://explorer.example.test/tx/${COSMOS}`);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!).origin).toBe(ORIGIN);
  });

  it("answers 404 when the testnet has no such transaction", async () => {
    const { x } = links(() => okJson({ txs: [], tx_responses: [], pagination: null, total: "0" }));
    const r = await x.handle("GET", `/go/tx/${EVM}`);
    expect(r.status).toBe(404);
    expect(r.headers.location).toBeUndefined();
  });

  it("answers 502 when the REST API fails or replies with garbage", async () => {
    expect((await links(() => okJson({ error: "x" }, 503)).x.handle("GET", `/go/tx/${EVM}`)).status).toBe(502);
    expect((await links(() => Promise.reject(new Error("down"))).x.handle("GET", `/go/tx/${EVM}`)).status).toBe(502);
    const garbage = () => new Response("<html>", { status: 200 });
    expect((await links(garbage).x.handle("GET", `/go/tx/${EVM}`)).status).toBe(502);
  });

  it.each(["", "/", "/0x12", `/${EVM}/x`, "/../lcd/x", `/${COSMOS}00`, "/0xZZ" + "a".repeat(62)])(
    "refuses a path that is not one hash: %s",
    async (rest) => {
      const { x, calls } = links(() => found(COSMOS));
      expect((await x.handle("GET", `/go/tx${rest}`)).status).toBe(404);
      expect(calls).toEqual([]);
    },
  );

  it("only answers GET and HEAD", async () => {
    const { x } = links(() => found(COSMOS));
    expect((await x.handle("POST", `/go/tx/${COSMOS}`)).status).toBe(405);
    expect((await x.handle("HEAD", `/go/tx/${COSMOS}`)).status).toBe(302);
  });
});

describe("receiptLookupUrl", () => {
  it("asks for the record call of this book that wrote this receipt id", () => {
    const u = receiptLookupUrl(ORIGIN, BOOK, "14");
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe("/cosmos/tx/v1beta1/txs");
    expect(u.searchParams.get("query")).toBe(`wasm._contract_address='${BOOK}' AND wasm.action='record' AND wasm.id='14'`);
    expect(u.searchParams.get("pagination.limit")).toBe("1");
  });
});

describe("ExplorerLinks receipts", () => {
  it("redirects a receipt id to the Cosmos transaction that wrote it", async () => {
    const { x, calls } = links(() => found(COSMOS));
    const r = await x.handleReceipt("GET", "/go/receipt/14");
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`https://explorer.example.test/tx/${COSMOS}`);
    expect(new URL(calls[0]!).searchParams.get("query")).toContain("wasm.id='14'");
  });

  it("answers 404 for an unknown receipt and 502 when the REST API fails", async () => {
    expect((await links(() => okJson({ tx_responses: [], total: "0" })).x.handleReceipt("GET", "/go/receipt/9")).status).toBe(404);
    expect((await links(() => okJson({ error: "x" }, 503)).x.handleReceipt("GET", "/go/receipt/9")).status).toBe(502);
  });

  it.each(["", "/", "/0", "/01", "/-1", "/1.5", "/1/x", "/14' OR '1'='1", "/18446744073709551616", "/abc"])(
    "refuses a path that is not one receipt id: %s",
    async (rest) => {
      const { x, calls } = links(() => found(COSMOS));
      expect((await x.handleReceipt("GET", `/go/receipt${rest}`)).status).toBe(404);
      expect(calls).toEqual([]);
    },
  );

  it("only answers GET and HEAD", async () => {
    const { x } = links(() => found(COSMOS));
    expect((await x.handleReceipt("POST", "/go/receipt/1")).status).toBe(405);
  });
});
