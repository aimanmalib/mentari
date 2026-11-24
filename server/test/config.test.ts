import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerConfig, resolvePrefix } from "../src/config.js";

const REAL = fileURLToPath(new URL("../../config/", import.meta.url));
const temps: string[] = [];
afterEach(() => temps.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function copy(
  edit: (limits: Record<string, any>, app: Record<string, any>, meter: Record<string, any>) => void,
): string {
  const d = mkdtempSync(join(tmpdir(), "mentari-cfg-"));
  temps.push(d);
  cpSync(REAL, d, { recursive: true });
  const limits = JSON.parse(readFileSync(join(d, "limits.json"), "utf8"));
  const app = JSON.parse(readFileSync(join(d, "app.json"), "utf8"));
  const meter = JSON.parse(readFileSync(join(d, "meter.json"), "utf8"));
  edit(limits, app, meter);
  writeFileSync(join(d, "limits.json"), JSON.stringify(limits));
  writeFileSync(join(d, "app.json"), JSON.stringify(app));
  writeFileSync(join(d, "meter.json"), JSON.stringify(meter));
  return `${d}/`;
}

describe("loadServerConfig", () => {
  it("reads the explorer redirect and ties the site's EVM link to the server route", () => {
    const c = loadServerConfig();
    expect(c.explorer.txTemplate).toMatch(/^https:\/\/.+\{hash\}/);
    expect(c.explorer.cacheSeconds).toBeGreaterThan(0);
    expect(() => loadServerConfig(copy((_l, app) => (app.web.explorer.evmTx = "/elsewhere/{hash}")))).toThrow(/evmTx/);
    expect(() => loadServerConfig(copy((_l, app) => (app.web.explorer.tx = "http://x.test/tx/{hash}")))).toThrow(/explorer\.tx/);
    expect(() => loadServerConfig(copy((l) => delete l.explorer))).toThrow(/limits\.json explorer/);
  });

  it("loads the committed config into the expected shape", () => {
    const c = loadServerConfig();
    expect(c.restOrigin).toMatch(/^https:\/\/[^/]+$/);
    expect(c.lcd.allowedPrefixes.length).toBeGreaterThan(0);
    for (const p of c.lcd.allowedPrefixes) expect(p).toMatch(/^\/[^{}]*$/);
    expect(c.clientIp.cloudflare.length).toBeGreaterThan(0);
    expect(typeof c.demo.enabled).toBe("boolean");
    for (const k of ["maxConcurrent", "perIpPerHour", "perDay", "minSenderBalanceQor", "retireWh", "timeoutMs"] as const) {
      expect(Number.isInteger(c.demo[k]) && c.demo[k] > 0).toBe(true);
    }
  });

  it("refuses a missing demo block, a non-boolean switch and bad demo numbers", () => {
    expect(() => loadServerConfig(copy((l) => delete l.demo))).toThrow(/demo/);
    expect(() => loadServerConfig(copy((l) => (l.demo.enabled = "yes")))).toThrow(/true or false/);
    expect(() => loadServerConfig(copy((l) => (l.demo.perDay = 0)))).toThrow(/demo.perDay/);
    expect(() => loadServerConfig(copy((l) => (l.demo.perIpPerHour = 1.5)))).toThrow(/demo.perIpPerHour/);
  });

  it("loads the daily meter run and refuses a bad time, switch or retry delay", () => {
    const c = loadServerConfig();
    expect(typeof c.meter.enabled).toBe("boolean");
    expect(Number.isInteger(c.meter.runAtMinute) && c.meter.runAtMinute >= 0 && c.meter.runAtMinute < 1440).toBe(true);
    expect(loadServerConfig(copy((_l, _a, m) => (m.daily.runAtUtc = "01:05"))).meter.runAtMinute).toBe(65);
    expect(() => loadServerConfig(copy((_l, _a, m) => delete m.daily))).toThrow(/meter.json daily/);
    expect(() => loadServerConfig(copy((_l, _a, m) => (m.daily.runAtUtc = "25:00")))).toThrow(/daily.runAtUtc.*HH:MM/);
    expect(() => loadServerConfig(copy((_l, _a, m) => (m.daily.enabled = 1)))).toThrow(/daily.enabled/);
    expect(() => loadServerConfig(copy((_l, _a, m) => (m.daily.retryMinutes = 0)))).toThrow(/daily.retryMinutes/);
  });

  it("loads what the live meter job needs and refuses a bad window, contract or RPC", () => {
    const c = loadServerConfig();
    expect(c.meterJob.model.simulated).toBe(true);
    expect(c.meterJob.windowDays).toBeGreaterThanOrEqual(1);
    expect(c.meterJob.windowDays).toBeLessThanOrEqual(c.meterJob.model.backfillDays);
    expect(c.meterJob.chain.evmRpc).toMatch(/^https:\/\//);
    const at = "0x00000000000000000000000000000000000000c3";
    const set = loadServerConfig(copy((_l, a, m) => ((a.contracts.mentari = at), (m.daily.windowDays = 2))));
    expect(set.meterJob).toMatchObject({ windowDays: 2, chain: { mentari: at } });
    expect(loadServerConfig(copy((_l, a) => (a.contracts.mentari = ""))).meterJob.chain.mentari).toBe("");
    expect(() => loadServerConfig(copy((_l, _a, m) => (m.daily.windowDays = 0)))).toThrow(/daily.windowDays/);
    expect(() => loadServerConfig(copy((_l, _a, m) => (m.daily.windowDays = m.backfillDays + 1)))).toThrow(
      /daily.windowDays/,
    );
    expect(() => loadServerConfig(copy((_l, a) => (a.contracts.mentari = "0x12")))).toThrow(/contracts.mentari/);
    expect(() => loadServerConfig(copy((_l, a) => (a.network.evmRpc = "http://x.test")))).toThrow(/evmRpc.*https/);
    expect(() => loadServerConfig(copy((_l, _a, m) => (m.simulated = false)))).toThrow(/simulated must be true/);
  });

  it("loads what the demo sender needs and refuses a bad memo, gas limit, probe or case D target", () => {
    const c = loadServerConfig();
    expect(c.demoChain.rest).toBe(c.restOrigin);
    expect(c.demoChain.evmRpc).toBe(c.meterJob.chain.evmRpc);
    expect(c.demoChain.restTimeoutMs).toBe(c.lcd.timeoutMs);
    expect(Number.isInteger(c.demoChain.revertCaseGas) && c.demoChain.revertCaseGas > 0).toBe(true);
    const probe = "0x00000000000000000000000000000000000000d4";
    const set = loadServerConfig(
      copy((_l, a) => ((a.contracts.atomicityProbe = probe), (a.native.notAllowlistedTarget = "qor1other"))),
    );
    expect(set.demoChain).toMatchObject({ atomicityProbe: probe, caseDTarget: "qor1other" });
    expect(() => loadServerConfig(copy((l) => (l.demo.retireMemo = "no \"quotes\"")))).toThrow(/demo.retireMemo/);
    expect(() => loadServerConfig(copy((l) => (l.demo.probeNote = "x".repeat(41))))).toThrow(/demo.probeNote/);
    expect(() => loadServerConfig(copy((l) => (l.demo.revertCaseGas = 0)))).toThrow(/demo.revertCaseGas/);
    expect(() => loadServerConfig(copy((_l, a) => (a.contracts.atomicityProbe = "0x1")))).toThrow(/contracts.atomicityProbe/);
    expect(() => loadServerConfig(copy((_l, a) => delete a.native.notAllowlistedTarget))).toThrow(/notAllowlistedTarget/);
  });

  it("loads the Native route switches and refuses a bad switch, gas limit or gas price", () => {
    const c = loadServerConfig();
    expect(typeof c.nativeRoute.demoRetire).toBe("boolean");
    expect(typeof c.nativeRoute.meter).toBe("boolean");
    expect(c.nativeRoute.lane.rest).toBe(c.restOrigin);
    expect(c.nativeRoute.lane.waitMs).toBeGreaterThan(c.nativeRoute.lane.pollMs);
    for (const g of [c.nativeRoute.retireGas, c.nativeRoute.attestGas]) expect(Number.isInteger(g) && g > 0).toBe(true);
    const off = loadServerConfig(copy((_l, a) => ((a.nativeRoute.demoRetire = false), (a.nativeRoute.meter = true))));
    expect(off.nativeRoute).toMatchObject({ demoRetire: false, meter: true });
    expect(() => loadServerConfig(copy((_l, a) => delete a.nativeRoute))).toThrow(/nativeRoute/);
    expect(() => loadServerConfig(copy((_l, a) => (a.nativeRoute.demoRetire = "on")))).toThrow(/nativeRoute.demoRetire/);
    expect(() => loadServerConfig(copy((_l, a) => (a.nativeRoute.retireGas = 0)))).toThrow(/nativeRoute.retireGas/);
    expect(() => loadServerConfig(copy((_l, a) => (a.nativeLane.gasPriceUqor = 0.15)))).toThrow(/gasPriceUqor/);
  });

  it("fills the receipts book into the smart-query prefix", () => {
    const c = loadServerConfig(copy((_l, app) => (app.native.receiptsBook = "qor1test")));
    expect(c.lcd.allowedPrefixes).toContain("/cosmwasm/wasm/v1/contract/qor1test/smart/");
  });

  it("refuses an http upstream, an unknown placeholder and bad numbers", () => {
    expect(() => loadServerConfig(copy((_l, app) => (app.network.rest = "http://x.test")))).toThrow(/https/);
    expect(() => loadServerConfig(copy((l) => (l.lcd.allowedPrefixes = ["/a/{nope}/"])))).toThrow(/placeholder/);
    expect(() => loadServerConfig(copy((l) => (l.lcd.cacheSeconds = 0)))).toThrow(/positive integer/);
  });
});

describe("resolvePrefix", () => {
  it("rejects relative or traversing prefixes", () => {
    expect(() => resolvePrefix("a/b", {})).toThrow();
    expect(() => resolvePrefix("/a/../b", {})).toThrow();
    expect(() => resolvePrefix("/a//b", {})).toThrow();
  });
});
