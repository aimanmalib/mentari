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

type FallbackReason = Refusal | "unavailable" | "low-funds" | "timeout" | "send-failed" | "not-quantum-ready";

// Cloudflare sits in front of the site and replaces the body of a 502 or 504 answer with its own text, so the page
// would lose the reason and the transaction hash. Failed and timed-out sends answer 503, which it passes through.
const STATUS: Record<FallbackReason, number> = {
  disabled: 503,
  unavailable: 503,
  "low-funds": 503,
  busy: 429,
  "daily-limit": 429,
  "ip-limit": 429,
  timeout: 503,
  "send-failed": 503,
  "not-quantum-ready": 409,
};

class TimedOut extends Error {}

interface RefusalExtra {
  retryAfterSeconds?: number | undefined;
  evmTx?: string | undefined;
}

/** A send that did not happen. `evidenceCase` names the recorded case the site shows instead, when there is one. */
function refuse(reason: FallbackReason, extra: RefusalExtra = {}, evidenceCase?: string): Reply {
  const headers: Record<string, string> = {};
  if (extra.retryAfterSeconds !== undefined) headers["retry-after"] = String(extra.retryAfterSeconds);
  const fallback = evidenceCase === undefined ? {} : { fallback: { evidenceCase } };
  return json(STATUS[reason], { ok: false, reason, ...extra, ...fallback }, headers);
}

const GRANT_PATH = /^\/grant\/(0x[0-9a-fA-F]{40})$/;

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
 * `/api/demo/*`: the "Retire now" button, the three failure buttons and the wallet grant. One visitor request = one
 * transaction from the demo account. Ledger sends report the counts before and after, and every refusal of one names
 * the recorded case to show instead.
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
    const grantTo = GRANT_PATH.exec(path)?.[1];
    const route = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
    if (!route && grantTo === undefined) return notFound();
    if (req.method !== "POST") return methodNotAllowed("POST");
    // A JSON body type makes a cross-site form or fetch preflight, which this server never answers.
    if (!isJson(req.contentType)) return json(415, { error: "send content-type: application/json" });
    return route ? this.#send(req.ip, route) : this.#grant(req.ip, grantTo!);
  }

  /** One demo transaction: a ledger send (`route`) or a grant. Shares the limits, the funds check and the deadline. */
  async #run(ip: string, evidenceCase: string | undefined, work: (commit: () => void, sent: (tx: string) => void) => Promise<Reply>): Promise<Reply> {
    if (!this.#chain.ready()) return refuse("unavailable", {}, evidenceCase);
    const start = this.#limiter.tryStart(ip);
    if (!start.ok) return refuse(start.reason, { retryAfterSeconds: start.retryAfterSeconds }, evidenceCase);
    const { ticket } = start;
    let evmTx: string | undefined;
    const running = (async (): Promise<Reply> => {
      if ((await this.#chain.senderBalanceQor()) < this.#limits.minSenderBalanceQor) return refuse("low-funds", {}, evidenceCase);
      return work(
        () => ticket.commit(),
        (tx) => {
          evmTx = tx;
        },
      );
    })().finally(() => ticket.release());

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_ok, fail) => {
      timer = setTimeout(() => fail(new TimedOut()), this.#limits.timeoutMs);
    });
    try {
      return await Promise.race([running, deadline]);
    } catch (err) {
      running.catch(() => undefined);
      const reason = err instanceof TimedOut ? "timeout" : "send-failed";
      return refuse(reason, evmTx === undefined ? {} : { evmTx }, evidenceCase);
    } finally {
      clearTimeout(timer);
    }
  }

  #send(ip: string, route: Route): Promise<Reply> {
    return this.#run(ip, route.evidenceCase, async (commit, sentTx) => {
      const before = await this.#chain.counts();
      commit();
      const sent = await this.#chain.send(route.action, { retireWh: this.#limits.retireWh });
      sentTx(sent.evmTx);
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
    });
  }

  /**
   * `POST /api/demo/grant/<address>`: the demo account sends `grantWh` certificates to a visitor's wallet, so the
   * visitor can retire from it. The contract only pays quantum-ready accounts; that is checked before any quota is used.
   */
  #grant(ip: string, to: string): Promise<Reply> {
    return this.#run(ip, undefined, async (commit, sentTx) => {
      if (!(await this.#chain.isQuantumReady(to))) return refuse("not-quantum-ready");
      commit();
      const sent = await this.#chain.grant(to, this.#limits.grantWh);
      sentTx(sent.evmTx);
      if (sent.status !== "success") return refuse("send-failed", { evmTx: sent.evmTx });
      return json(200, { ok: true, action: "grant", to, wh: this.#limits.grantWh, evmTx: sent.evmTx });
    });
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
