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
