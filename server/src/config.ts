import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateMeterConfig, type MeterConfig } from "../../scripts/src/meter.js";
import { parseRunAt, type DailySchedule } from "./meter/daily.js";
import type { DemoChainConfig } from "./demo/live.js";
import type { MeterChain } from "./meter/live.js";
import { EXPLORER_MOUNT, RECEIPT_MOUNT } from "./explorer.js";
import type { NativeLaneConfig } from "./native.js";

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
  /** Where the demo sender sends and what (contracts, memo, case D target). */
  demoChain: DemoChainConfig;
  /** The daily meter run (block `daily` of `config/meter.json`). */
  meter: DailySchedule;
  /** What the live meter job needs: the simulated meter model, how far back it looks, and the contract. */
  meterJob: { model: MeterConfig; windowDays: number; chain: MeterChain };
  /** Which jobs send from the Native lane, and how (block `nativeRoute` of `config/app.json`, decision 0026). */
  nativeRoute: NativeRoute;
  /** `/go/tx/<hash>` and `/go/receipt/<id>` redirects (decisions 0033, 0034): explorer page shape, cache time, book. */
  explorer: { txTemplate: string; cacheSeconds: number; receiptsBook: string };
}

export interface NativeRoute {
  lane: NativeLaneConfig;
  /** "Retire now" is sent as a `MsgCrossVMCall`. */
  demoRetire: boolean;
  /** The three failure buttons (cases B, C, D) are sent as `MsgCrossVMCall`s (decision 0030). */
  demoCases: boolean;
  /** The wallet grant (`Mentari.transfer`) is sent as a `MsgCrossVMCall` (decision 0030). */
  grant: boolean;
  /** The daily meter job's `attest` calls are sent as `MsgCrossVMCall`s. */
  meter: boolean;
  retireGas: number;
  caseGas: number;
  grantGas: number;
  attestGas: number;
  /** Codespace of an EVM revert inside a Native call. A failure in any other codespace is not the expected revert. */
  revertCodespace: string;
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
  /** How long `/api/demo/status` reuses one read of the chain (balance, certificates, EVM window). */
  statusCacheMs: number;
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
    statusCacheMs: n("statusCacheSeconds") * 1000,
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

/** Same rule as `ReceiptNote.isValidMemo`: what the contracts accept as a memo or a probe note. */
const MEMO = /^[A-Za-z0-9 .:/#-]{0,40}$/;

function memo(v: unknown, where: string): string {
  if (typeof v !== "string" || !MEMO.test(v)) throw new Error(`${where}: expected up to 40 characters from [A-Za-z0-9 .:/#-]`);
  return v;
}

/** An EVM address, or "" while the contract is not deployed. */
function contractAddress(v: unknown, where: string): string {
  if (typeof v !== "string" || (v !== "" && !/^0x[0-9a-fA-F]{40}$/.test(v))) {
    throw new Error(`${where}: expected an EVM address or an empty string`);
  }
  return v;
}

function demoChain(
  meterChain: MeterChain,
  app: Record<string, unknown>,
  native: Record<string, unknown>,
  limitsDemo: unknown,
  restOrigin: string,
  restTimeoutMs: number,
): DemoChainConfig {
  const d = obj(limitsDemo, "config/limits.json demo");
  const target = native.notAllowlistedTarget;
  if (typeof target !== "string") throw new Error("config/app.json native.notAllowlistedTarget: expected a string");
  return {
    evmRpc: meterChain.evmRpc,
    evmChainId: meterChain.evmChainId,
    rest: restOrigin,
    receiptsBook: str(native.receiptsBook, "config/app.json native.receiptsBook"),
    mentari: meterChain.mentari,
    atomicityProbe: contractAddress(obj(app.contracts, "config/app.json contracts").atomicityProbe, "config/app.json contracts.atomicityProbe"),
    restTimeoutMs,
    retireMemo: memo(d.retireMemo, "demo.retireMemo"),
    probeNote: memo(d.probeNote, "demo.probeNote"),
    revertCaseGas: posInt(d.revertCaseGas, "demo.revertCaseGas"),
    caseDTarget: target,
  };
}

function meterJob(meter: Record<string, unknown>, app: Record<string, unknown>, network: Record<string, unknown>) {
  const model = meter as unknown as MeterConfig;
  validateMeterConfig(model);
  const windowDays = obj(meter.daily, "config/meter.json daily").windowDays;
  if (!Number.isInteger(windowDays) || (windowDays as number) < 1 || (windowDays as number) > model.backfillDays) {
    throw new Error("config/meter.json daily.windowDays: expected a whole number from 1 to backfillDays");
  }
  const mentari = contractAddress(obj(app.contracts, "config/app.json contracts").mentari, "config/app.json contracts.mentari");
  const evmRpc = new URL(str(network.evmRpc, "config/app.json network.evmRpc"));
  if (evmRpc.protocol !== "https:") throw new Error("config/app.json network.evmRpc: must be https");
  const chain = { evmRpc: evmRpc.href, evmChainId: posInt(network.evmChainId, "network.evmChainId"), mentari };
  return { model, windowDays: windowDays as number, chain };
}

function nativeRoute(app: Record<string, unknown>, network: Record<string, unknown>, restOrigin: string): NativeRoute {
  const r = obj(app.nativeRoute, "config/app.json nativeRoute");
  const lane = obj(app.nativeLane, "config/app.json nativeLane");
  const price = lane.gasPriceUqor;
  if (typeof price !== "string" || !/^\d+(\.\d+)?$/.test(price))
    throw new Error("config/app.json nativeLane.gasPriceUqor: expected a decimal string");
  return {
    lane: {
      chainId: str(network.chainId, "config/app.json network.chainId"),
      rest: restOrigin,
      denom: str(lane.denom, "config/app.json nativeLane.denom"),
      gasPriceUqor: price,
      waitMs: posInt(lane.waitSeconds, "nativeLane.waitSeconds") * 1000,
      pollMs: posInt(lane.pollSeconds, "nativeLane.pollSeconds") * 1000,
    },
    demoRetire: bool(r.demoRetire, "nativeRoute.demoRetire"),
    demoCases: bool(r.demoCases, "nativeRoute.demoCases"),
    grant: bool(r.grant, "nativeRoute.grant"),
    meter: bool(r.meter, "nativeRoute.meter"),
    retireGas: posInt(r.retireGas, "nativeRoute.retireGas"),
    caseGas: posInt(r.caseGas, "nativeRoute.caseGas"),
    grantGas: posInt(r.grantGas, "nativeRoute.grantGas"),
    attestGas: posInt(r.attestGas, "nativeRoute.attestGas"),
    revertCodespace: str(r.revertCodespace, "config/app.json nativeRoute.revertCodespace"),
  };
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

  const lcdTimeoutMs = posInt(lcd.timeoutMs, "lcd.timeoutMs");
  const job = meterJob(meter, app, network);
  return {
    restOrigin: rest.origin,
    lcd: {
      allowedPrefixes: strList(lcd.allowedPrefixes, "lcd.allowedPrefixes").map((p) => resolvePrefix(p, vars)),
      cacheSeconds: posInt(lcd.cacheSeconds, "lcd.cacheSeconds"),
      cacheMaxEntries: posInt(lcd.cacheMaxEntries, "lcd.cacheMaxEntries"),
      timeoutMs: lcdTimeoutMs,
      maxBodyBytes: posInt(lcd.maxBodyBytes, "lcd.maxBodyBytes"),
    },
    clientIp: {
      trustedProxies: strList(clientIp.trustedProxies, "clientIp.trustedProxies"),
      cloudflare: [...strList(cf.v4, "cloudflare-ips v4"), ...strList(cf.v6, "cloudflare-ips v6")],
    },
    demo: demoLimits(limits.demo),
    demoChain: demoChain(job.chain, app, native, limits.demo, rest.origin, lcdTimeoutMs),
    meter: dailySchedule(meter.daily),
    meterJob: job,
    nativeRoute: nativeRoute(app, network, rest.origin),
    explorer: explorerLinks(app, limits),
  };
}

/** Explorer redirect settings. `web.explorer.evmTx` and `receiptTx` must point at this server's own routes. */
function explorerLinks(app: Record<string, unknown>, limits: Record<string, unknown>): ServerConfig["explorer"] {
  const web = obj(obj(app.web, "config/app.json web").explorer, "config/app.json web.explorer");
  const txTemplate = str(web.tx, "config/app.json web.explorer.tx");
  if (!txTemplate.startsWith("https://") || !txTemplate.includes("{hash}")) {
    throw new Error("config/app.json web.explorer.tx: must be an https URL with a {hash} placeholder");
  }
  const evmTx = str(web.evmTx, "config/app.json web.explorer.evmTx");
  if (evmTx !== `${EXPLORER_MOUNT}/{hash}`) {
    throw new Error(`config/app.json web.explorer.evmTx: must be "${EXPLORER_MOUNT}/{hash}" (the server route)`);
  }
  const receiptTx = str(web.receiptTx, "config/app.json web.explorer.receiptTx");
  if (receiptTx !== `${RECEIPT_MOUNT}/{id}`) {
    throw new Error(`config/app.json web.explorer.receiptTx: must be "${RECEIPT_MOUNT}/{id}" (the server route)`);
  }
  const lim = obj(limits.explorer, "config/limits.json explorer");
  const receiptsBook = str(obj(app.native, "config/app.json native").receiptsBook, "config/app.json native.receiptsBook");
  return { txTemplate, cacheSeconds: posInt(lim.redirectCacheSeconds, "explorer.redirectCacheSeconds"), receiptsBook };
}
