import { describe, expect, it } from "vitest";
import { asExpected, DemoApi, type DemoRequest } from "../src/demo/api.js";
import { unconfiguredChain } from "../src/demo/chain.js";
import { demoLimits, FakeChain } from "./fixture.js";

const JSON_TYPE = "application/json";

function req(url: string, over: Partial<DemoRequest> = {}): DemoRequest {
  return { method: "POST", url, ip: "203.0.113.7", contentType: JSON_TYPE, ...over };
}

function body(r: { body: unknown }): any {
  return JSON.parse(String(r.body));
}

function setup(limits = demoLimits({ perIpPerHour: 9, perDay: 9 })) {
  const chain = new FakeChain();
  return { chain, api: new DemoApi(limits, chain) };
}

describe("DemoApi sends", () => {
  it("retires and reports both ledgers before and after", async () => {
    const { api, chain } = setup();
    const r = await api.handle(req("/api/demo/retire"));
    expect(r.status).toBe(200);
    expect(body(r)).toEqual({
      ok: true,
      action: "retire",
      expect: "success",
      evmTx: `0x${"a".repeat(64)}`,
      txStatus: "success",
      receipts: { before: 10, after: 11 },
      retirements: { before: 4, after: 5 },
      asExpected: true,
      evidenceCase: "A",
    });
    expect(chain.sends).toEqual([{ action: "retire", retireWh: 500 }]);
  });

  it.each(["b", "c", "d"])("runs failure case %s and shows the ledgers unchanged", async (c) => {
    const { api, chain } = setup();
    const out = body(await api.handle(req(`/api/demo/case/${c}`)));
    expect(out).toMatchObject({ ok: true, action: `case-${c}`, expect: "revert", txStatus: "reverted", asExpected: true });
    expect(out.receipts).toEqual({ before: 10, after: 10 });
    expect(out.evidenceCase).toBe(c.toUpperCase());
    expect(chain.sends[0]?.action).toBe(`case-${c}`);
  });

  it("answers a retirement sent from the Native lane with its Cosmos hash and no EVM hash", async () => {
    const { api, chain } = setup();
    const cosmosTx = "8E15D319".padEnd(64, "A");
    chain.onSend = async () => {
      chain.ledgers = { receipts: chain.ledgers.receipts + 1, retirements: chain.ledgers.retirements + 1 };
      return { cosmosTx, status: "success" };
    };
    const out = body(await api.handle(req("/api/demo/retire")));
    expect(out).toMatchObject({ ok: true, cosmosTx, txStatus: "success", asExpected: true });
    expect(out).not.toHaveProperty("evmTx");
  });

  it("flags a failure case that changed a ledger as not expected", async () => {
    const { api, chain } = setup();
    chain.onSend = async () => {
      chain.ledgers = { ...chain.ledgers, receipts: chain.ledgers.receipts + 1 };
      return { evmTx: "0x1", status: "reverted" };
    };
    expect(body(await api.handle(req("/api/demo/case/b"))).asExpected).toBe(false);
  });

  it("ignores the query string", async () => {
    const { api } = setup();
    expect((await api.handle(req("/api/demo/retire?x=1"))).status).toBe(200);
  });
});

describe("DemoApi refuses", () => {
  it("returns 404 for unknown paths and 405 for other methods", async () => {
    const { api, chain } = setup();
    for (const u of ["/api/demo", "/api/demo/case/a", "/api/demo/case/e", "/api/demo/constructor", "/api/demo/retire/"]) {
      expect((await api.handle(req(u))).status).toBe(404);
    }
    const get = await api.handle(req("/api/demo/retire", { method: "GET" }));
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe("POST");
    expect((await api.handle(req("/api/demo/status", { method: "POST" }))).status).toBe(405);
    expect(chain.sends).toEqual([]);
  });

  it("requires a JSON content type so other sites cannot post a form", async () => {
    const { api, chain } = setup();
    for (const t of [undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      expect((await api.handle(req("/api/demo/retire", { contentType: t }))).status).toBe(415);
    }
    expect((await api.handle(req("/api/demo/retire", { contentType: "Application/JSON; charset=utf-8" }))).status).toBe(200);
    expect(chain.sends.length).toBe(1);
  });

  it("falls back to the recorded case when the switch is off", async () => {
    const { api, chain } = setup(demoLimits({ enabled: false }));
    const r = await api.handle(req("/api/demo/case/c"));
    expect(r.status).toBe(503);
    expect(body(r)).toEqual({ ok: false, reason: "disabled", fallback: { evidenceCase: "C" } });
    expect(chain.sends).toEqual([]);
  });

  it("falls back while the sender is not configured", async () => {
    const api = new DemoApi(demoLimits(), unconfiguredChain);
    const r = await api.handle(req("/api/demo/retire"));
    expect(r.status).toBe(503);
    expect(body(r)).toMatchObject({ reason: "unavailable", fallback: { evidenceCase: "A" } });
  });

  it("falls back on low funds without spending the visitor's quota", async () => {
    const { api, chain } = setup(demoLimits({ perIpPerHour: 1, perDay: 1, minSenderBalanceQor: 8 }));
    chain.balance = 7.99;
    const r = await api.handle(req("/api/demo/retire"));
    expect(r.status).toBe(503);
    expect(body(r)).toMatchObject({ reason: "low-funds", fallback: { evidenceCase: "A" } });
    chain.balance = 8;
    expect((await api.handle(req("/api/demo/retire"))).status).toBe(200);
  });

  it("limits each visitor and sends retry-after", async () => {
    const { api } = setup(demoLimits({ perIpPerHour: 2, perDay: 9 }));
    await api.handle(req("/api/demo/retire"));
    await api.handle(req("/api/demo/case/b"));
    const r = await api.handle(req("/api/demo/case/c"));
    expect(r.status).toBe(429);
    expect(body(r)).toMatchObject({ reason: "ip-limit", fallback: { evidenceCase: "C" } });
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect((await api.handle(req("/api/demo/case/c", { ip: "198.51.100.1" }))).status).toBe(200);
  });

  it("stops all visitors after the daily total", async () => {
    const { api } = setup(demoLimits({ perIpPerHour: 9, perDay: 2 }));
    await api.handle(req("/api/demo/retire", { ip: "a" }));
    await api.handle(req("/api/demo/retire", { ip: "b" }));
    const r = await api.handle(req("/api/demo/retire", { ip: "c" }));
    expect(r.status).toBe(429);
    expect(body(r).reason).toBe("daily-limit");
  });

  it("answers busy while another send is in flight, then frees the slot", async () => {
    const { api, chain } = setup();
    let finish: () => void = () => undefined;
    chain.onSend = () =>
      new Promise((ok) => {
        finish = () => ok({ evmTx: "0x2", status: "success" });
      });
    const first = api.handle(req("/api/demo/retire", { ip: "a" }));
    await new Promise((ok) => setImmediate(ok));
    const second = await api.handle(req("/api/demo/case/d", { ip: "b" }));
    expect(second.status).toBe(429);
    expect(body(second)).toMatchObject({ reason: "busy", fallback: { evidenceCase: "D" } });
    finish();
    chain.onSend = async () => ({ evmTx: "0x5", status: "reverted" });
    expect((await first).status).toBe(200);
    expect((await api.handle(req("/api/demo/case/d", { ip: "b" }))).status).toBe(200);
  });

  it("times out a slow send but keeps the slot until the chain call settles", async () => {
    const { api, chain } = setup(demoLimits({ perIpPerHour: 9, perDay: 9, timeoutMs: 20 }));
    let finish: () => void = () => undefined;
    chain.onSend = () =>
      new Promise((ok) => {
        finish = () => ok({ evmTx: "0x3", status: "success" });
      });
    const r = await api.handle(req("/api/demo/retire"));
    expect(r.status).toBe(503);
    expect(body(r)).toMatchObject({ reason: "timeout", fallback: { evidenceCase: "A" } });
    expect(body(await api.handle(req("/api/demo/retire", { ip: "b" }))).reason).toBe("busy");
    finish();
    await new Promise((ok) => setImmediate(ok));
    expect(body(await api.handle(req("/api/demo/status", { method: "GET" }))).busy).toBe(false);
  });

  it("reports a failed send as 503 without internal detail and frees the slot", async () => {
    const { api, chain } = setup();
    chain.onSend = async () => {
      throw new Error("nonce too low at 10.0.0.5");
    };
    const r = await api.handle(req("/api/demo/retire"));
    expect(r.status).toBe(503);
    expect(String(r.body)).not.toContain("nonce");
    expect(body(r)).toMatchObject({ reason: "send-failed", fallback: { evidenceCase: "A" } });
    chain.onSend = async () => ({ evmTx: "0x4", status: "success" });
    expect((await api.handle(req("/api/demo/retire"))).status).toBe(200);
  });

  it("keeps the transaction hash when reading the ledgers after the send fails", async () => {
    const { api, chain } = setup();
    let calls = 0;
    chain.counts = async () => {
      calls += 1;
      if (calls > 1) throw new Error("rpc down");
      return { receipts: 1, retirements: 1 };
    };
    const r = await api.handle(req("/api/demo/retire"));
    expect(r.status).toBe(503);
    expect(body(r).evmTx).toBe(`0x${"a".repeat(64)}`);
  });
});

describe("DemoApi status", () => {
  it("reports switch, readiness and what is left for this visitor", async () => {
    const { api } = setup(demoLimits({ perIpPerHour: 2, perDay: 3 }));
    await api.handle(req("/api/demo/retire"));
    const s = await api.handle(req("/api/demo/status", { method: "GET" }));
    expect(s.status).toBe(200);
    const native = { ready: true, lane: "native", reason: null };
    expect(body(s)).toEqual({
      enabled: true,
      ready: true,
      busy: false,
      remainingToday: 2,
      remainingForYou: 1,
      retire: native,
      cases: native,
      grant: native,
      senderBalanceQor: 50,
      evmWindow: { live: false, untilBlock: 10626639 },
    });
  });

  it("does not say ready for jobs on the EVM lane once the demo account's window has expired", async () => {
    const { api, chain } = setup();
    chain.lanes = { retire: "native", cases: "evm-window", grant: "evm-window" };
    const s = body(await api.handle(req("/api/demo/status", { method: "GET" })));
    expect(s.retire).toEqual({ ready: true, lane: "native", reason: null });
    expect(s.cases).toEqual({ ready: false, lane: "evm-window", reason: "window-closed" });
    expect(s.grant).toEqual({ ready: false, lane: "evm-window", reason: "window-closed" });
    expect(s.evmWindow).toEqual({ live: false, untilBlock: 10626639 });
    // "Retire now" can still send, so the page stays live; the failure buttons show their recorded cases.
    expect(s.ready).toBe(true);
  });

  it("is not ready at all when no button can send, and says the chain is unavailable when it cannot be read", async () => {
    const { api, chain } = setup();
    chain.lanes = { retire: "evm-window", cases: "evm-window", grant: "evm-window" };
    chain.evmWindow = null;
    const s = body(await api.handle(req("/api/demo/status", { method: "GET" })));
    expect(s.ready).toBe(false);
    expect(s.retire).toEqual({ ready: false, lane: "evm-window", reason: "unavailable" });

    const off = body(await new DemoApi(demoLimits(), unconfiguredChain).handle(req("/api/demo/status", { method: "GET" })));
    expect(off).toMatchObject({ ready: false, senderBalanceQor: null, evmWindow: null, cases: { ready: false, lane: null, reason: "unavailable" } });
  });

  it("names low funds and missing certificates per job", async () => {
    const { api, chain } = setup(demoLimits({ retireWh: 500, grantWh: 700 }));
    chain.certificatesWh = 600;
    let s = body(await api.handle(req("/api/demo/status", { method: "GET" })));
    expect([s.retire.ready, s.cases.ready, s.grant.reason]).toEqual([true, true, "no-certificates"]);
    const fresh = setup();
    fresh.chain.balance = 1;
    s = body(await fresh.api.handle(req("/api/demo/status", { method: "GET" })));
    expect([s.retire.reason, s.cases.reason, s.grant.reason]).toEqual(["low-funds", "low-funds", "low-funds"]);
  });

  it("reuses one chain read for statusCacheMs", async () => {
    let t = 1_000;
    const chain = new FakeChain();
    const api = new DemoApi(demoLimits({ statusCacheMs: 15_000 }), chain, undefined, () => t);
    const get = () => api.handle(req("/api/demo/status", { method: "GET" }));
    await get();
    t += 14_999;
    await get();
    expect(chain.stateReads).toBe(1);
    t += 1;
    await get();
    expect(chain.stateReads).toBe(2);
  });
});

describe("DemoApi sends check the lane first", () => {
  it.each(["b", "c", "d"])("refuses case %s while its EVM window is closed, sends nothing and keeps the quota", async (c) => {
    const { api, chain } = setup(demoLimits({ perIpPerHour: 1, perDay: 1 }));
    chain.lanes = { retire: "native", cases: "evm-window", grant: "native" };
    const r = await api.handle(req(`/api/demo/case/${c}`));
    expect(r.status).toBe(503);
    expect(body(r)).toEqual({ ok: false, reason: "window-closed", fallback: { evidenceCase: c.toUpperCase() } });
    expect(chain.sends).toEqual([]);
    chain.evmWindow = { live: true, untilBlock: 10700000 };
    expect((await api.handle(req(`/api/demo/case/${c}`))).status).toBe(200);
  });

  it("sends the failure cases on the Native lane with no window open", async () => {
    const { api, chain } = setup();
    chain.onSend = async () => ({ cosmosTx: "9837A24B".padEnd(64, "B"), status: "reverted" });
    const out = body(await api.handle(req("/api/demo/case/b")));
    expect(out).toMatchObject({ ok: true, cosmosTx: "9837A24B".padEnd(64, "B"), txStatus: "reverted", asExpected: true });
    expect(chain.evmWindow?.live).toBe(false);
  });

  it("refuses a retirement or a grant when the demo account lacks the certificates", async () => {
    const { api, chain } = setup();
    chain.certificatesWh = 499;
    chain.quantumReady.add("0x" + "ab".repeat(20));
    expect(body(await api.handle(req("/api/demo/retire")))).toMatchObject({ reason: "no-certificates", fallback: { evidenceCase: "A" } });
    expect(body(await api.handle(req(`/api/demo/grant/0x${"ab".repeat(20)}`)))).toEqual({ ok: false, reason: "no-certificates" });
    expect(chain.sends).toEqual([]);
    expect(chain.grants).toEqual([]);
  });
});

describe("asExpected", () => {
  const before = { receipts: 3, retirements: 3 };
  it("needs one more of each ledger for success and no change for revert", () => {
    const ok = { evmTx: "0x", status: "success" as const };
    const rev = { evmTx: "0x", status: "reverted" as const };
    expect(asExpected({ expect: "success" }, ok, before, { receipts: 4, retirements: 4 })).toBe(true);
    expect(asExpected({ expect: "success" }, ok, before, { receipts: 4, retirements: 3 })).toBe(false);
    expect(asExpected({ expect: "success" }, rev, before, { receipts: 4, retirements: 4 })).toBe(false);
    expect(asExpected({ expect: "revert" }, rev, before, before)).toBe(true);
    expect(asExpected({ expect: "revert" }, ok, before, before)).toBe(false);
    expect(asExpected({ expect: "revert" }, rev, before, { receipts: 3, retirements: 4 })).toBe(false);
  });
});

describe("DemoApi grant to a visitor's wallet", () => {
  const wallet = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
  const url = `/api/demo/grant/${wallet}`;

  it("sends grantWh to a quantum-ready wallet", async () => {
    const { api, chain } = setup(demoLimits({ perIpPerHour: 9, perDay: 9, grantWh: 700 }));
    chain.quantumReady.add(wallet.toLowerCase());
    const r = await api.handle(req(url));
    expect(r.status).toBe(200);
    expect(body(r)).toEqual({ ok: true, action: "grant", to: wallet, wh: 700, evmTx: `0x${"c".repeat(64)}` });
    expect(chain.grants).toEqual([{ to: wallet, wh: 700 }]);
    expect(chain.sends).toEqual([]);
  });

  it("refuses a wallet without a registered key and does not use the visitor's quota", async () => {
    const { api, chain } = setup(demoLimits({ perIpPerHour: 1, perDay: 9 }));
    const r = await api.handle(req(url));
    expect(r.status).toBe(409);
    expect(body(r)).toEqual({ ok: false, reason: "not-quantum-ready" });
    expect(chain.grants).toEqual([]);
    expect(body(await api.handle(req("/api/demo/status", { method: "GET" }))).remainingForYou).toBe(1);
  });

  it("counts a grant against the same hourly limit as the other buttons", async () => {
    const { api, chain } = setup(demoLimits({ perIpPerHour: 1, perDay: 9 }));
    chain.quantumReady.add(wallet.toLowerCase());
    expect((await api.handle(req(url))).status).toBe(200);
    const r = await api.handle(req("/api/demo/retire"));
    expect(r.status).toBe(429);
    expect(body(r).reason).toBe("ip-limit");
  });

  it("reports a reverted transfer as a failed send with its hash", async () => {
    const { api, chain } = setup();
    chain.quantumReady.add(wallet.toLowerCase());
    chain.onGrant = async () => ({ evmTx: "0xdead", status: "reverted" });
    const r = await api.handle(req(url));
    expect(r.status).toBe(503);
    expect(body(r)).toEqual({ ok: false, reason: "send-failed", evmTx: "0xdead" });
  });

  it("has no recorded case to fall back to when the sender is not configured", async () => {
    const api = new DemoApi(demoLimits(), unconfiguredChain);
    const r = await api.handle(req(url));
    expect(r.status).toBe(503);
    expect(body(r)).toEqual({ ok: false, reason: "unavailable" });
  });

  it.each([
    ["/api/demo/grant/0x1234", 404],
    [`/api/demo/grant/${wallet}/x`, 404],
    ["/api/demo/grant/", 404],
  ])("rejects %s", async (path, status) => {
    const { api, chain } = setup();
    expect((await api.handle(req(path))).status).toBe(status);
    expect(chain.grants).toEqual([]);
  });

  it("only accepts POST with a JSON body type", async () => {
    const { api } = setup();
    expect((await api.handle(req(url, { method: "GET" }))).status).toBe(405);
    expect((await api.handle(req(url, { contentType: "text/plain" }))).status).toBe(415);
  });
});
