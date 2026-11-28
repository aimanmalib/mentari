import type { MeterConfig } from "../../scripts/src/meter.js";
import type { DemoLimits, ServerConfig } from "../src/config.js";
import type { ChainState, DemoAction, DemoChain, LedgerCounts, SendResult } from "../src/demo/chain.js";

export const ORIGIN = "https://rest.example.test";
export const BOOK = "qor1book";

/** Frozen config for tests. It does not read `config/`, so changing the live values never breaks a test. */
/** Stand-in for the demo film: 1000 bytes, each its own index mod 256, so any slice is checkable. */
export const VIDEO_BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

export function testConfig(over: Partial<ServerConfig["lcd"]> = {}): ServerConfig {
  return {
    restOrigin: ORIGIN,
    lcd: {
      allowedPrefixes: [
        `/cosmwasm/wasm/v1/contract/${BOOK}/smart/`,
        "/qorechain/crossvm/v1/params",
        "/cosmos/tx/v1beta1/txs/",
        "/qorechain/pqc/v1/",
      ],
      cacheSeconds: 5,
      cacheMaxEntries: 3,
      timeoutMs: 1000,
      maxBodyBytes: 64,
      ...over,
    },
    clientIp: {
      trustedProxies: ["127.0.0.0/8", "::1/128", "172.16.0.0/12"],
      cloudflare: ["173.245.48.0/20", "2606:4700::/32"],
    },
    demo: demoLimits(),
    demoChain: {
      evmRpc: "https://evm.example.test/",
      evmChainId: 9800,
      rest: ORIGIN,
      receiptsBook: BOOK,
      mentari: "",
      atomicityProbe: "",
      restTimeoutMs: 1000,
      retireMemo: "fixture memo",
      probeNote: "fixture note",
      revertCaseGas: 3000000,
      caseDTarget: "",
    },
    meter: { enabled: true, runAtMinute: 20, retryMinutes: 30 },
    meterJob: { model: meterModel(), windowDays: 1, chain: { evmRpc: "https://evm.example.test/", evmChainId: 9800, mentari: "" } },
    nativeRoute: {
      lane: { chainId: "fixture-1", rest: ORIGIN, denom: "uqor", gasPriceUqor: "0.15", waitMs: 1000, pollMs: 10 },
      demoRetire: true,
      demoCases: true,
      grant: true,
      meter: false,
      retireGas: 1300000,
      caseGas: 1500000,
      grantGas: 800000,
      attestGas: 2000000,
      revertCodespace: "crossvm",
    },
    explorer: { txTemplate: "https://explorer.example.test/tx/{hash}", cacheSeconds: 600, receiptsBook: "qor1booktest" },
    readings: { contract: "0xF5cb2c6048a7CE8c5A7ACcc66eB8efc33942a448", max: 2, pageSize: 2, maxPages: 3, cacheSeconds: 60 },
    videoCopy: { path: "/video/demo.mp4", bytes: VIDEO_BYTES.length, sha256: "ab".repeat(32), cacheSeconds: 600 },
  };
}

/** Frozen simulated meter model, independent of `config/meter.json`. */
export function meterModel(): MeterConfig {
  return {
    simulated: true,
    maxSunHoursX10: 80,
    backfillDays: 3,
    model: { seed: "fixture-seed", meanSunHours: 4.6, spreadSunHours: 1.2 },
    systems: [
      { id: 1, label: "A", capacityW: 5000 },
      { id: 2, label: "B", capacityW: 8200 },
    ],
  };
}

/** Frozen demo limits for tests, independent of `config/limits.json`. */
export function demoLimits(over: Partial<DemoLimits> = {}): DemoLimits {
  return {
    enabled: true,
    maxConcurrent: 1,
    perIpPerHour: 2,
    perDay: 3,
    minSenderBalanceQor: 8,
    retireWh: 500,
    grantWh: 500,
    timeoutMs: 1000,
    statusCacheMs: 15000,
    ...over,
  };
}

/**
 * A chain double with ledgers that move like the real contracts: `retire` adds one receipt and one retirement,
 * every failure case reverts and changes nothing. No key, no network.
 */
export class FakeChain implements DemoChain {
  isReady = true;
  balance = 50;
  certificatesWh = 100_000;
  lanes: ChainState["lanes"] = { retire: "native", cases: "native", grant: "native" };
  evmWindow: ChainState["evmWindow"] = { live: false, untilBlock: 10626639 };
  /** How many times the chain state was read. */
  stateReads = 0;
  ledgers: LedgerCounts = { receipts: 10, retirements: 4 };
  sends: { action: DemoAction; retireWh: number }[] = [];
  grants: { to: string; wh: number }[] = [];
  /** Accounts with a registered ML-DSA-87 key, as `Mentari.isQuantumReady` would answer. */
  quantumReady = new Set<string>();
  onGrant: (to: string) => Promise<SendResult> = async () => ({ evmTx: `0x${"c".repeat(64)}`, status: "success" });
  /** Replace to make a send hang, throw or misbehave. */
  onSend: (action: DemoAction) => Promise<SendResult> = async (action) => {
    if (action !== "retire") return { evmTx: `0x${"b".repeat(64)}`, status: "reverted" };
    this.ledgers = { receipts: this.ledgers.receipts + 1, retirements: this.ledgers.retirements + 1 };
    return { evmTx: `0x${"a".repeat(64)}`, status: "success" };
  };

  ready(): boolean {
    return this.isReady;
  }

  async state(): Promise<ChainState> {
    this.stateReads += 1;
    return { lanes: { ...this.lanes }, senderBalanceQor: this.balance, certificatesWh: this.certificatesWh, evmWindow: this.evmWindow };
  }

  async counts(): Promise<LedgerCounts> {
    return { ...this.ledgers };
  }

  send(action: DemoAction, opts: { retireWh: number }): Promise<SendResult> {
    this.sends.push({ action, retireWh: opts.retireWh });
    return this.onSend(action);
  }

  async isQuantumReady(account: string): Promise<boolean> {
    return this.quantumReady.has(account.toLowerCase());
  }

  grant(to: string, wh: number): Promise<SendResult> {
    this.grants.push({ to, wh });
    return this.onGrant(to);
  }
}

export interface FakeFetch {
  calls: string[];
  fn: (url: string, init: RequestInit) => Promise<Response>;
}

export function fakeFetch(reply: (url: string) => Response | Promise<Response> = () => okJson({ ok: 1 })): FakeFetch {
  const calls: string[] = [];
  return {
    calls,
    fn: async (url) => {
      calls.push(url);
      return reply(url);
    },
  };
}

export function okJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
