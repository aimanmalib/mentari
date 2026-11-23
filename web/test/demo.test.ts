import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_ACTIONS, knownFallback, readStatus, runDemo, type DemoFetch } from "../src/data/demo.js";

const HASH = `0x${"ab".repeat(32)}`;

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: Parameters<DemoFetch>[1] } = {}): DemoFetch {
  return async (url, init) => {
    seen.url = url;
    seen.init = init;
    return { status, json: async () => body };
  };
}

describe("DEMO_ACTIONS", () => {
  it("matches the routes and recorded cases the server answers", () => {
    const server = readFileSync(new URL("../../server/src/demo/api.ts", import.meta.url), "utf8");
    const routes = [...server.matchAll(/"(\/[\w/]+)": \{ action: "([\w-]+)", expect: "(\w+)", evidenceCase: "(\w+)" \}/g)].map((m) => ({
      path: m[1],
      action: m[2],
      expect: m[3],
      evidenceCase: m[4],
    }));
    expect(routes).toHaveLength(4);
    expect([...DEMO_ACTIONS].sort((a, b) => a.path.localeCompare(b.path))).toEqual(routes.sort((a, b) => a.path!.localeCompare(b.path!)));
  });
});

describe("runDemo", () => {
  it("posts JSON to the action's path and reads a sent transaction", async () => {
    const seen: { url?: string; init?: Parameters<DemoFetch>[1] } = {};
    const body = {
      ok: true,
      evmTx: HASH,
      txStatus: "success",
      receipts: { before: 5, after: 6 },
      retirements: { before: 2, after: 3 },
      asExpected: true,
    };
    const out = await runDemo(fakeFetch(200, body, seen), "/api/demo", "retire");
    expect(seen.url).toBe("/api/demo/retire");
    expect(seen.init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    expect(out).toEqual({
      kind: "sent",
      action: "retire",
      expect: "success",
      tx: { lane: "evm", hash: HASH },
      txStatus: "success",
      receipts: body.receipts,
      retirements: body.retirements,
      asExpected: true,
      evidenceCase: "A",
    });
  });

  it("reads a retirement sent from the Native lane by its Cosmos hash", async () => {
    const cosmosTx = "8E15D319".padEnd(64, "A");
    const body = { ok: true, cosmosTx, txStatus: "success", receipts: { before: 5, after: 6 }, retirements: { before: 2, after: 3 }, asExpected: true };
    const out = await runDemo(fakeFetch(200, body), "/api/demo", "retire");
    expect(out).toMatchObject({ kind: "sent", tx: { lane: "native", hash: cosmosTx }, txStatus: "success" });
  });

  it.each([
    ["no hash", {}],
    ["both hashes", { evmTx: HASH, cosmosTx: "A".repeat(64) }],
    ["a lowercase or 0x Cosmos hash", { cosmosTx: `0x${"a".repeat(64)}` }],
  ])("shows the recorded case for an answer with %s", async (_name, tx) => {
    const body = { ok: true, ...tx, txStatus: "success", receipts: { before: 5, after: 6 }, retirements: { before: 2, after: 3 }, asExpected: true };
    expect(await runDemo(fakeFetch(200, body), "/api/demo", "retire")).toMatchObject({ kind: "fallback", reason: "unavailable" });
  });

  it("reads asExpected strictly: anything but true is false", async () => {
    const body = { ok: true, evmTx: HASH, txStatus: "reverted", receipts: { before: 1, after: 1 }, retirements: { before: 1, after: 1 }, asExpected: "yes" };
    const out = await runDemo(fakeFetch(200, body), "/api/demo", "case-b");
    expect(out.kind === "sent" && out.asExpected).toBe(false);
  });

  it("turns a refusal into the recorded case, keeping retry-after and the transaction hash", async () => {
    const out = await runDemo(fakeFetch(429, { ok: false, reason: "ip-limit", retryAfterSeconds: 120, evmTx: HASH }), "/api/demo", "case-c");
    expect(out).toEqual({ kind: "fallback", action: "case-c", reason: "ip-limit", retryAfterSeconds: 120, evmTx: HASH, evidenceCase: "C" });
  });

  it("shows an unknown reason as unavailable", async () => {
    const out = await runDemo(fakeFetch(503, { ok: false, reason: "<script>" }), "/api/demo", "case-d");
    expect(out).toMatchObject({ kind: "fallback", reason: "unavailable", evidenceCase: "D" });
  });

  it("treats a malformed success as unavailable instead of showing bad numbers", async () => {
    const out = await runDemo(fakeFetch(200, { ok: true, evmTx: HASH, evmStatus: "success", receipts: {}, retirements: {} }), "/api/demo", "retire");
    expect(out).toMatchObject({ kind: "fallback", reason: "unavailable" });
  });

  it("treats a short transaction hash as unavailable even when the counts are valid", async () => {
    const counts = { receipts: { before: 1, after: 2 }, retirements: { before: 1, after: 2 } };
    const out = await runDemo(fakeFetch(200, { ok: true, evmTx: "0x12", evmStatus: "success", ...counts }), "/api/demo", "retire");
    expect(out).toMatchObject({ kind: "fallback", reason: "unavailable" });
  });

  it("says unreachable when the request or its body fails", async () => {
    const down: DemoFetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await runDemo(down, "/api/demo", "retire")).toMatchObject({ kind: "fallback", reason: "unreachable", evidenceCase: "A" });
    const html: DemoFetch = async () => ({ status: 502, json: async () => Promise.reject(new SyntaxError("not json")) });
    expect(await runDemo(html, "/api/demo", "retire")).toMatchObject({ reason: "unreachable" });
  });
});

describe("readStatus", () => {
  it("reads the server's status", async () => {
    const s = await readStatus(fakeFetch(200, { enabled: true, ready: true, busy: false, remainingToday: 30, remainingForYou: 4 }), "/api/demo");
    expect(s).toEqual({ enabled: true, ready: true, busy: false, remainingToday: 30, remainingForYou: 4 });
  });

  it("returns null when the server is down or answers something else", async () => {
    expect(await readStatus(fakeFetch(404, { enabled: true, ready: true }), "/api/demo")).toBeNull();
    expect(await readStatus(fakeFetch(200, "<html>"), "/api/demo")).toBeNull();
    expect(
      await readStatus(async () => {
        throw new Error("down");
      }, "/api/demo"),
    ).toBeNull();
  });
});

describe("knownFallback", () => {
  const base = { busy: false, remainingToday: 1, remainingForYou: 1 };
  it("skips the request when the status says sends cannot run", () => {
    expect(knownFallback({ ...base, enabled: false, ready: true }, "case-c")).toEqual({
      kind: "fallback",
      action: "case-c",
      reason: "disabled",
      evidenceCase: "C",
    });
    expect(knownFallback({ ...base, enabled: true, ready: false }, "retire")).toMatchObject({ reason: "unavailable", evidenceCase: "A" });
  });

  it("tries the send when sends are open or the status is unknown", () => {
    expect(knownFallback({ ...base, enabled: true, ready: true }, "retire")).toBeNull();
    expect(knownFallback(null, "retire")).toBeNull();
    expect(knownFallback("loading", "retire")).toBeNull();
  });
});
