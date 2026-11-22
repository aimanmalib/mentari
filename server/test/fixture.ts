import type { ServerConfig } from "../src/config.js";

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
  };
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
