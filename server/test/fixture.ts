import type { DemoLimits, ServerConfig } from "../src/config.js";
import type { DemoAction, DemoChain, LedgerCounts, SendResult } from "../src/demo/chain.js";

export const ORIGIN = "https://rest.example.test";
export const BOOK = "qor1book";

/** Frozen config for tests. It does not read `config/`, so changing the live values never breaks a test. */
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
    meter: { enabled: true, runAtMinute: 20, retryMinutes: 30 },
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

  async senderBalanceQor(): Promise<number> {
    return this.balance;
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
