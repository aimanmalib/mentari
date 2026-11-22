import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateMeterConfig, type MeterConfig } from "../../scripts/src/meter.js";
import { parseRunAt, type DailySchedule } from "./meter/daily.js";
import type { MeterChain } from "./meter/live.js";

/** Everything the server reads from `config/`. Code never holds these values. */
export interface ServerConfig {
  /** Native REST origin the `/lcd` proxy may reach. Nothing else is ever fetched. */
  restOrigin: string;
  lcd: {
    /** Resolved path prefixes (placeholders already replaced). */
    allowedPrefixes: string[];
    cacheSeconds: number;
    cacheMaxEntries: number;
    timeoutMs: number;
    maxBodyBytes: number;
  };
  clientIp: {
    /** Proxies in front of the server (traefik on the host network). */
    trustedProxies: string[];
    /** Cloudflare edge ranges; only these may set `cf-connecting-ip`. */
    cloudflare: string[];
  };
  demo: DemoLimits;
  /** The daily meter run (block `daily` of `config/meter.json`). */
  meter: DailySchedule;
  /** What the live meter job needs: the simulated meter model, how far back it looks, and the contract. */
  meterJob: { model: MeterConfig; windowDays: number; chain: MeterChain };
}

/** Limits and switches for `/api/demo` (block `demo` of `config/limits.json`). */
export interface DemoLimits {
  /** Kill switch: `false` closes every demo send; the site then shows the recorded evidence. */
  enabled: boolean;
  maxConcurrent: number;
  perIpPerHour: number;
  /** Sends per UTC calendar day across all visitors. */
  perDay: number;
  /** Below this sender balance (whole QOR) the demo stops sending. */
  minSenderBalanceQor: number;
  /** Energy (Wh) one "Retire now" retires. */
  retireWh: number;
  /** Certificates (Wh) the demo account sends to a visitor's own wallet on request. */
  grantWh: number;
  /** Longest a visitor waits for one send; the slot stays taken until the chain call settles. */
  timeoutMs: number;
}

export const CONFIG_DIR = fileURLToPath(new URL("../../config/", import.meta.url));

function readJson(dir: string, name: string): unknown {
  return JSON.parse(readFileSync(`${dir}${name}`, "utf8"));
}

function obj(v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${where}: expected an object`);
  return v as Record<string, unknown>;
}

function str(v: unknown, where: string): string {
  if (typeof v !== "string" || v === "") throw new Error(`${where}: expected a non-empty string`);
  return v;
}

function posInt(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) throw new Error(`${where}: expected a positive integer`);
  return v;
}

function bool(v: unknown, where: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${where}: expected true or false`);
  return v;
}

function demoLimits(v: unknown): DemoLimits {
  const d = obj(v, "config/limits.json demo");
  const n = (k: string) => posInt(d[k], `demo.${k}`);
  return {
    enabled: bool(d.enabled, "demo.enabled"),
    maxConcurrent: n("maxConcurrent"),
    perIpPerHour: n("perIpPerHour"),
    perDay: n("perDay"),
    minSenderBalanceQor: n("minSenderBalanceQor"),
    retireWh: n("retireWh"),
    grantWh: n("grantWh"),
    timeoutMs: n("timeoutMs"),
  };
}

function dailySchedule(v: unknown): DailySchedule {
  const d = obj(v, "config/meter.json daily");
  let runAtMinute: number;
  try {
    runAtMinute = parseRunAt(str(d.runAtUtc, "daily.runAtUtc"));
  } catch (err) {
    throw new Error(`config/meter.json daily.runAtUtc: ${(err as Error).message}`);
  }
  return {
    enabled: bool(d.enabled, "daily.enabled"),
    runAtMinute,
    retryMinutes: posInt(d.retryMinutes, "daily.retryMinutes"),
  };
}

function meterJob(meter: Record<string, unknown>, app: Record<string, unknown>, network: Record<string, unknown>) {
  const model = meter as unknown as MeterConfig;
  validateMeterConfig(model);
  const windowDays = obj(meter.daily, "config/meter.json daily").windowDays;
  if (!Number.isInteger(windowDays) || (windowDays as number) < 1 || (windowDays as number) > model.backfillDays) {
    throw new Error("config/meter.json daily.windowDays: expected a whole number from 1 to backfillDays");
  }
  const mentari = obj(app.contracts, "config/app.json contracts").mentari;
  if (typeof mentari !== "string" || (mentari !== "" && !/^0x[0-9a-fA-F]{40}$/.test(mentari))) {
    throw new Error("config/app.json contracts.mentari: expected an EVM address or an empty string");
  }
  const evmRpc = new URL(str(network.evmRpc, "config/app.json network.evmRpc"));
  if (evmRpc.protocol !== "https:") throw new Error("config/app.json network.evmRpc: must be https");
  const chain = { evmRpc: evmRpc.href, evmChainId: posInt(network.evmChainId, "network.evmChainId"), mentari };
  return { model, windowDays: windowDays as number, chain };
}

function strList(v: unknown, where: string): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new Error(`${where}: expected a non-empty list`);
  return v.map((x, i) => str(x, `${where}[${i}]`));
}

/** Replace `{name}` placeholders with values from `vars`; an unknown name is a config error. */
export function resolvePrefix(prefix: string, vars: Record<string, string>): string {
  const out = prefix.replace(/\{([A-Za-z]+)\}/g, (_m, name: string) => {
    const v = vars[name];
    if (v === undefined) throw new Error(`config/limits.json lcd.allowedPrefixes: unknown placeholder {${name}}`);
    return v;
  });
  if (!out.startsWith("/") || out.includes("//") || out.includes("..")) {
    throw new Error(`config/limits.json lcd.allowedPrefixes: "${out}" must be an absolute path without "//" or ".."`);
  }
  return out;
}

export function loadServerConfig(dir: string = CONFIG_DIR): ServerConfig {
  const app = obj(readJson(dir, "app.json"), "config/app.json");
  const limits = obj(readJson(dir, "limits.json"), "config/limits.json");
  const cf = obj(readJson(dir, "cloudflare-ips.json"), "config/cloudflare-ips.json");
  const meter = obj(readJson(dir, "meter.json"), "config/meter.json");
  const network = obj(app.network, "config/app.json network");
  const native = obj(app.native, "config/app.json native");
  const lcd = obj(limits.lcd, "config/limits.json lcd");
  const clientIp = obj(limits.clientIp, "config/limits.json clientIp");

  const rest = new URL(str(network.rest, "config/app.json network.rest"));
  if (rest.protocol !== "https:") throw new Error("config/app.json network.rest: must be https");
  const vars = { receiptsBook: str(native.receiptsBook, "config/app.json native.receiptsBook") };

  return {
    restOrigin: rest.origin,
    lcd: {
      allowedPrefixes: strList(lcd.allowedPrefixes, "lcd.allowedPrefixes").map((p) => resolvePrefix(p, vars)),
      cacheSeconds: posInt(lcd.cacheSeconds, "lcd.cacheSeconds"),
      cacheMaxEntries: posInt(lcd.cacheMaxEntries, "lcd.cacheMaxEntries"),
      timeoutMs: posInt(lcd.timeoutMs, "lcd.timeoutMs"),
      maxBodyBytes: posInt(lcd.maxBodyBytes, "lcd.maxBodyBytes"),
    },
    clientIp: {
      trustedProxies: strList(clientIp.trustedProxies, "clientIp.trustedProxies"),
      cloudflare: [...strList(cf.v4, "cloudflare-ips v4"), ...strList(cf.v6, "cloudflare-ips v6")],
    },
    demo: demoLimits(limits.demo),
    meter: dailySchedule(meter.daily),
    meterJob: meterJob(meter, app, network),
  };
}
