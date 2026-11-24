import { describe, expect, it } from "vitest";
import { LcdProxy } from "../src/lcd.js";
import { ATTEST_SELECTOR, Readings, readingsFrom, readingsPageUrl } from "../src/readings.js";
import { fakeFetch, okJson, ORIGIN, testConfig } from "./fixture.js";

const CONTRACT = "0xF5cb2c6048a7CE8c5A7ACcc66eB8efc33942a448";
const HASH = (c: string) => c.repeat(64);
const b64 = (hex: string) => Buffer.from(hex.replace(/^0x/, ""), "hex").toString("base64");
const ATTEST = `${ATTEST_SELECTOR}${"00".repeat(40)}`;
const RETIRE = `0x12345678${"00".repeat(40)}`;

function tx(payloadHex: string, target = CONTRACT, type = "/qorechain.crossvm.v1.MsgCrossVMCall") {
  return { body: { messages: [{ "@type": type, target_contract: target, payload: b64(payloadHex) }] } };
}
function resp(hash: string, code = 0, height = "10638500") {
  return { txhash: hash, code, height };
}
function page(rows: [ReturnType<typeof tx>, ReturnType<typeof resp>][], total: number) {
  return { txs: rows.map((r) => r[0]), tx_responses: rows.map((r) => r[1]), total: String(total) };
}

describe("readingsPageUrl", () => {
  it("asks the fixed origin for the contract's Native-lane calls, newest first, one page", () => {
    const u = readingsPageUrl(ORIGIN, CONTRACT, 2, 15);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe("/cosmos/tx/v1beta1/txs");
    expect(u.searchParams.get("query")).toBe(`crossvm_request.target_contract='${CONTRACT}'`);
    expect(u.searchParams.get("order_by")).toBe("ORDER_BY_DESC");
    expect([u.searchParams.get("page"), u.searchParams.get("limit")]).toEqual(["2", "15"]);
  });

  it("checksums a lower-case address, because the chain's index matches it case-sensitively", () => {
    const u = readingsPageUrl(ORIGIN, CONTRACT.toLowerCase(), 1, 15);
    expect(u.searchParams.get("query")).toBe(`crossvm_request.target_contract='${CONTRACT}'`);
  });
});

describe("readingsFrom", () => {
  it("keeps only accepted attest calls into the contract and returns their calldata as hex", () => {
    const body = page(
      [
        [tx(ATTEST), resp(HASH("a"))],
        [tx(RETIRE), resp(HASH("b"))],
        [tx(ATTEST), resp(HASH("c"), 14)],
        [tx(ATTEST, "0x0000000000000000000000000000000000000001"), resp(HASH("d"))],
        [tx(ATTEST, CONTRACT, "/cosmos.bank.v1beta1.MsgSend"), resp(HASH("e"))],
        [tx(ATTEST), resp("not-a-hash")],
      ],
      6,
    );
    expect(readingsFrom(body, CONTRACT.toLowerCase())).toEqual([{ cosmosTx: HASH("A"), height: 10638500, calldata: ATTEST }]);
  });

  it("returns nothing for a reply of the wrong shape", () => {
    expect(readingsFrom(null, CONTRACT)).toEqual([]);
    expect(readingsFrom({ txs: [], tx_responses: {} }, CONTRACT)).toEqual([]);
  });
});

describe("Readings", () => {
  const cfg = { restOrigin: ORIGIN, contract: CONTRACT, max: 2, pageSize: 2, maxPages: 3, cacheSeconds: 60 };

  function readings(pages: unknown[], now = () => 0) {
    const f = fakeFetch((url) => okJson(pages[Number(new URL(url).searchParams.get("page")) - 1] ?? {}));
    return { r: new Readings(cfg, new LcdProxy(testConfig({ maxBodyBytes: 100_000 }), f.fn), now), calls: f.calls };
  }

  it("reads pages until it has max readings and caches the list", async () => {
    const { r, calls } = readings([
      page([[tx(RETIRE), resp(HASH("1"))], [tx(ATTEST), resp(HASH("2"))]], 9),
      page([[tx(ATTEST), resp(HASH("3"))], [tx(ATTEST), resp(HASH("4"))]], 9),
    ]);
    const reply = await r.handle("GET");
    expect(reply.status).toBe(200);
    expect(reply.headers["cache-control"]).toBe("public, max-age=60");
    const value = JSON.parse(String(reply.body));
    expect(value.complete).toBe(true);
    expect(value.readings.map((x: { cosmosTx: string }) => x.cosmosTx)).toEqual([HASH("2"), HASH("3")]);
    expect(calls).toHaveLength(2);
    await r.handle("GET");
    expect(calls).toHaveLength(2);
  });

  it("stops at the last page and at maxPages, and says when the list may be short", async () => {
    const end = readings([page([[tx(ATTEST), resp(HASH("5"))]], 1)]);
    expect(JSON.parse(String((await end.r.handle("GET")).body))).toMatchObject({ complete: true });
    expect(end.calls).toHaveLength(1);
    const none = page([[tx(RETIRE), resp(HASH("6"))], [tx(RETIRE), resp(HASH("7"))]], 99);
    const capped = readings([none, none, none, none]);
    expect(JSON.parse(String((await capped.r.handle("GET")).body))).toEqual({ readings: [], complete: false });
    expect(capped.calls).toHaveLength(3);
  });

  it("lists nothing and asks nothing before the contract is deployed", async () => {
    const f = fakeFetch();
    const r = new Readings({ ...cfg, contract: "" }, new LcdProxy(testConfig({ maxBodyBytes: 100_000 }), f.fn));
    expect(JSON.parse(String((await r.handle("GET")).body))).toEqual({ readings: [], complete: true });
    expect(f.calls).toHaveLength(0);
  });

  it("answers 502 when the REST API fails and 405 for other methods", async () => {
    const f = fakeFetch(() => okJson({ message: "down" }, 500));
    const r = new Readings(cfg, new LcdProxy(testConfig({ maxBodyBytes: 100_000 }), f.fn));
    expect((await r.handle("GET")).status).toBe(502);
    expect((await r.handle("POST")).status).toBe(405);
  });
});
