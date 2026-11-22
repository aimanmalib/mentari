/** Client for `POST /api/demo/grant/<address>`: the demo account sends certificates to the visitor's wallet. */
import type { DemoFetch } from "./demo.js";

/** Refusals the page can explain. Anything else the server says is shown as "unavailable". */
export const GRANT_REFUSALS = [
  "disabled",
  "unavailable",
  "low-funds",
  "busy",
  "daily-limit",
  "ip-limit",
  "timeout",
  "send-failed",
  "not-quantum-ready",
  "unreachable",
] as const;
export type GrantRefusal = (typeof GRANT_REFUSALS)[number];

export type GrantOutcome =
  | { kind: "sent"; evmTx: string; wh: number }
  | { kind: "refused"; reason: GrantRefusal; retryAfterSeconds?: number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Asks for certificates. Never throws: a network error or an unexpected answer becomes a refusal. */
export async function requestGrant(fetchFn: DemoFetch, base: string, address: string): Promise<GrantOutcome> {
  if (!ADDRESS.test(address)) return { kind: "refused", reason: "unavailable" };
  let body: unknown;
  try {
    const res = await fetchFn(`${base}/grant/${address}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    body = await res.json();
  } catch {
    return { kind: "refused", reason: "unreachable" };
  }
  if (!isObj(body)) return { kind: "refused", reason: "unavailable" };
  if (body.ok === true) {
    if (typeof body.evmTx !== "string" || !HASH.test(body.evmTx) || typeof body.wh !== "number") return { kind: "refused", reason: "unavailable" };
    return { kind: "sent", evmTx: body.evmTx, wh: body.wh };
  }
  const reason = (GRANT_REFUSALS as readonly unknown[]).includes(body.reason) ? (body.reason as GrantRefusal) : "unavailable";
  const out: GrantOutcome = { kind: "refused", reason };
  if (typeof body.retryAfterSeconds === "number" && Number.isFinite(body.retryAfterSeconds)) out.retryAfterSeconds = body.retryAfterSeconds;
  return out;
}
