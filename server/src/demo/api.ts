import type { DemoLimits } from "../config.js";
import { json, methodNotAllowed, notFound, type Reply } from "../http.js";
import type { DemoAction, DemoChain, LedgerCounts, SendResult } from "./chain.js";
import { DemoLimiter, type Refusal } from "./limits.js";

export const DEMO_MOUNT = "/api/demo";

interface Route {
  action: DemoAction;
  expect: "success" | "revert";
  /** Recorded case the site shows (and re-checks live) when this send cannot run. */
  evidenceCase: string;
}

const ROUTES: Record<string, Route> = {
  "/retire": { action: "retire", expect: "success", evidenceCase: "A" },
  "/case/b": { action: "case-b", expect: "revert", evidenceCase: "B" },
  "/case/c": { action: "case-c", expect: "revert", evidenceCase: "C" },
  "/case/d": { action: "case-d", expect: "revert", evidenceCase: "D" },
};

export interface DemoRequest {
  method: string;
  url: string;
  ip: string;
  contentType?: string | undefined;
}

type FallbackReason = Refusal | "unavailable" | "low-funds" | "timeout" | "send-failed";

const STATUS: Record<FallbackReason, number> = {
  disabled: 503,
  unavailable: 503,
  "low-funds": 503,
  busy: 429,
  "daily-limit": 429,
  "ip-limit": 429,
  timeout: 504,
  "send-failed": 502,
};

class TimedOut extends Error {}

function fallback(route: Route, reason: FallbackReason, extra: { retryAfterSeconds?: number | undefined; evmTx?: string | undefined } = {}): Reply {
  const headers: Record<string, string> = {};
  if (extra.retryAfterSeconds !== undefined) headers["retry-after"] = String(extra.retryAfterSeconds);
  return json(STATUS[reason], { ok: false, reason, ...extra, fallback: { evidenceCase: route.evidenceCase } }, headers);
}

/** True when both ledgers moved the way the case says: one more of each on success, no change on revert. */
export function asExpected(route: Pick<Route, "expect">, sent: SendResult, before: LedgerCounts, after: LedgerCounts): boolean {
  if (route.expect === "success") {
    return sent.status === "success" && after.receipts === before.receipts + 1 && after.retirements === before.retirements + 1;
  }
  return sent.status === "reverted" && after.receipts === before.receipts && after.retirements === before.retirements;
}

function isJson(contentType: string | undefined): boolean {
  return (contentType ?? "").split(";")[0]!.trim().toLowerCase() === "application/json";
}

/**
 * `/api/demo/*`: the "Retire now" button and the three failure buttons. One visitor request = one transaction from
 * the demo account, with the ledger counts read before and after. Every refusal names the recorded case to show instead.
 */
export class DemoApi {
  readonly #limits: DemoLimits;
  readonly #chain: DemoChain;
  readonly #limiter: DemoLimiter;

  constructor(limits: DemoLimits, chain: DemoChain, limiter: DemoLimiter = new DemoLimiter(limits)) {
    this.#limits = limits;
    this.#chain = chain;
    this.#limiter = limiter;
  }

  async handle(req: DemoRequest): Promise<Reply> {
    const q = req.url.indexOf("?");
    const path = (q === -1 ? req.url : req.url.slice(0, q)).slice(DEMO_MOUNT.length);
    if (path === "/status") {
      return req.method === "GET" || req.method === "HEAD" ? this.#status(req.ip) : methodNotAllowed("GET, HEAD");
    }
    const route = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
    if (!route) return notFound();
    if (req.method !== "POST") return methodNotAllowed("POST");
    // A JSON body type makes a cross-site form or fetch preflight, which this server never answers.
    if (!isJson(req.contentType)) return json(415, { error: "send content-type: application/json" });
    if (!this.#chain.ready()) return fallback(route, "unavailable");

    const start = this.#limiter.tryStart(req.ip);
    if (!start.ok) return fallback(route, start.reason, { retryAfterSeconds: start.retryAfterSeconds });
    const { ticket } = start;
    let evmTx: string | undefined;
    const work = (async (): Promise<Reply> => {
      if ((await this.#chain.senderBalanceQor()) < this.#limits.minSenderBalanceQor) return fallback(route, "low-funds");
      const before = await this.#chain.counts();
      ticket.commit();
      const sent = await this.#chain.send(route.action, { retireWh: this.#limits.retireWh });
      evmTx = sent.evmTx;
      const after = await this.#chain.counts();
      return json(200, {
        ok: true,
        action: route.action,
        expect: route.expect,
        evmTx: sent.evmTx,
        evmStatus: sent.status,
        receipts: { before: before.receipts, after: after.receipts },
        retirements: { before: before.retirements, after: after.retirements },
        asExpected: asExpected(route, sent, before, after),
        evidenceCase: route.evidenceCase,
      });
    })().finally(() => ticket.release());

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_ok, fail) => {
      timer = setTimeout(() => fail(new TimedOut()), this.#limits.timeoutMs);
    });
    try {
      return await Promise.race([work, deadline]);
    } catch (err) {
      work.catch(() => undefined);
      const reason = err instanceof TimedOut ? "timeout" : "send-failed";
      return fallback(route, reason, evmTx === undefined ? {} : { evmTx });
    } finally {
      clearTimeout(timer);
    }
  }

  #status(ip: string): Reply {
    const left = this.#limiter.remaining(ip);
    return json(200, {
      enabled: this.#limits.enabled,
      ready: this.#chain.ready(),
      busy: this.#limiter.busy,
      remainingToday: left.today,
      remainingForYou: left.forYou,
    });
  }
}
