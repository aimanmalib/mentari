import { describe, expect, it } from "vitest";
import { isAllowedPath, LcdProxy, upstreamUrl } from "../src/lcd.js";
import { BOOK, fakeFetch, okJson, ORIGIN, testConfig } from "./fixture.js";

const prefixes = testConfig().lcd.allowedPrefixes;

describe("isAllowedPath", () => {
  it("treats a trailing slash as a subtree and anything else as exact", () => {
    expect(isAllowedPath("/cosmos/tx/v1beta1/txs/ABC", prefixes)).toBe(true);
    expect(isAllowedPath("/cosmos/tx/v1beta1/txs/", prefixes)).toBe(false);
    expect(isAllowedPath("/qorechain/crossvm/v1/params", prefixes)).toBe(true);
    expect(isAllowedPath("/qorechain/crossvm/v1/params-x", prefixes)).toBe(false);
    expect(isAllowedPath("/qorechain/crossvm/v1/params/x", prefixes)).toBe(false);
  });
});

describe("upstreamUrl", () => {
  const u = (rest: string) => upstreamUrl(rest, ORIGIN, prefixes)?.href ?? null;

  it("keeps the fixed origin and the query string", () => {
    expect(u("/cosmos/tx/v1beta1/txs/AB12?x=1")).toBe(`${ORIGIN}/cosmos/tx/v1beta1/txs/AB12?x=1`);
    expect(u(`/cosmwasm/wasm/v1/contract/${BOOK}/smart/eyJ4Ijp7fX0%3D`)).toBe(
      `${ORIGIN}/cosmwasm/wasm/v1/contract/${BOOK}/smart/eyJ4Ijp7fX0%3D`,
    );
  });

  it("refuses paths outside the allowlist, including other contracts", () => {
    expect(u("/cosmos/bank/v1beta1/balances/qor1x")).toBeNull();
    expect(u("/cosmwasm/wasm/v1/contract/qor1other/smart/e30=")).toBeNull();
    expect(u("/")).toBeNull();
    expect(u("")).toBeNull();
  });

  it.each([
    "//evil.example/cosmos/tx/v1beta1/txs/A",
    "@evil.example/cosmos/tx/v1beta1/txs/A",
    ".evil.example/cosmos/tx/v1beta1/txs/A",
    ":8080/cosmos/tx/v1beta1/txs/A",
    "/cosmos/tx/v1beta1/txs/../../bank/v1beta1/supply",
    "/cosmos/tx/v1beta1/txs/%2e%2e/%2e%2e/bank",
    "/cosmos/tx/v1beta1/txs/a\\..\\b",
    "/qorechain/pqc/v1/./x",
  ])("never leaves the origin or the allowlist: %s", (rest) => {
    expect(u(rest)).toBeNull();
  });
});

describe("LcdProxy", () => {
  it("fetches an allowed path from the fixed origin", async () => {
    const f = fakeFetch(() => okJson({ params: 1 }));
    const r = await new LcdProxy(testConfig(), f.fn).handle("GET", "/lcd/qorechain/crossvm/v1/params");
    expect(r.status).toBe(200);
    expect(JSON.parse(String(r.body))).toEqual({ params: 1 });
    expect(r.headers["cache-control"]).toBe("public, max-age=5");
    expect(f.calls).toEqual([`${ORIGIN}/qorechain/crossvm/v1/params`]);
  });

  it("returns 404 without calling upstream for a path outside the list", async () => {
    const f = fakeFetch();
    const r = await new LcdProxy(testConfig(), f.fn).handle("GET", "/lcd/cosmos/bank/v1beta1/supply");
    expect(r.status).toBe(404);
    expect(f.calls).toHaveLength(0);
  });

  it.each(["POST", "PUT", "DELETE", "HEAD", "OPTIONS"])("answers %s with 405 and never calls upstream", async (m) => {
    const f = fakeFetch();
    const r = await new LcdProxy(testConfig(), f.fn).handle(m, "/lcd/qorechain/crossvm/v1/params");
    expect(r.status).toBe(405);
    expect(r.headers.allow).toBe("GET");
    expect(f.calls).toHaveLength(0);
  });

  it("serves from cache for the configured seconds, then refetches", async () => {
    let now = 1_000;
    const f = fakeFetch();
    const p = new LcdProxy(testConfig(), f.fn, () => now);
    const path = "/lcd/qorechain/pqc/v1/params";
    await p.handle("GET", path);
    now += 4_999;
    await p.handle("GET", path);
    expect(f.calls).toHaveLength(1);
    now += 1;
    await p.handle("GET", path);
    expect(f.calls).toHaveLength(2);
  });

  it("joins concurrent requests for the same key into one upstream call", async () => {
    const f = fakeFetch(async () => okJson({ slow: true }));
    const p = new LcdProxy(testConfig(), f.fn);
    await Promise.all([1, 2, 3].map(() => p.handle("GET", "/lcd/qorechain/pqc/v1/x")));
    expect(f.calls).toHaveLength(1);
  });

  it("does not cache upstream 5xx replies", async () => {
    const f = fakeFetch(() => okJson({ error: "down" }, 503));
    const p = new LcdProxy(testConfig(), f.fn);
    expect((await p.handle("GET", "/lcd/qorechain/pqc/v1/x")).status).toBe(503);
    await p.handle("GET", "/lcd/qorechain/pqc/v1/x");
    expect(f.calls).toHaveLength(2);
  });

  it("evicts the oldest entry above the cache limit", async () => {
    const f = fakeFetch();
    const p = new LcdProxy(testConfig({ cacheMaxEntries: 2 }), f.fn);
    for (const k of ["a", "b", "c", "a"]) await p.handle("GET", `/lcd/qorechain/pqc/v1/${k}`);
    expect(f.calls).toHaveLength(4);
  });

  it("turns network failures, timeouts and oversized replies into 502", async () => {
    const down = new LcdProxy(testConfig(), fakeFetch(() => Promise.reject(new Error("boom"))).fn);
    const r1 = await down.handle("GET", "/lcd/qorechain/pqc/v1/x");
    expect(r1.status).toBe(502);
    expect(String(r1.body)).not.toContain("boom");

    const big = new LcdProxy(testConfig(), fakeFetch(() => okJson({ pad: "x".repeat(100) })).fn);
    const r2 = await big.handle("GET", "/lcd/qorechain/pqc/v1/x");
    expect(r2.status).toBe(502);
    expect(String(r2.body)).toContain("too large");
  });

  it("asks fetch not to follow redirects and to time out", async () => {
    let seen: RequestInit | undefined;
    const p = new LcdProxy(testConfig(), async (_u, init) => {
      seen = init;
      return okJson({});
    });
    await p.handle("GET", "/lcd/qorechain/pqc/v1/x");
    expect(seen?.redirect).toBe("error");
    expect(seen?.method).toBe("GET");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });
});
