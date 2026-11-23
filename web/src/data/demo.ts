/** Client for the server's `/api/demo` routes: the "Retire now" button and the three failure buttons. */

export type DemoAction = "retire" | "case-b" | "case-c" | "case-d";

/** The four buttons, in page order. `evidenceCase` is the recorded case shown when a send cannot run. */
export const DEMO_ACTIONS: readonly { action: DemoAction; path: string; expect: "success" | "revert"; evidenceCase: string }[] = [
  { action: "retire", path: "/retire", expect: "success", evidenceCase: "A" },
  { action: "case-b", path: "/case/b", expect: "revert", evidenceCase: "B" },
  { action: "case-c", path: "/case/c", expect: "revert", evidenceCase: "C" },
  { action: "case-d", path: "/case/d", expect: "revert", evidenceCase: "D" },
];

export interface DemoStatus {
  enabled: boolean;
  ready: boolean;
  busy: boolean;
  remainingToday: number;
  remainingForYou: number;
}

export interface Counts {
  before: number;
  after: number;
}

export type DemoOutcome =
  | {
      kind: "sent";
      action: DemoAction;
      expect: "success" | "revert";
      /** The transaction: an EVM one, or a Native `MsgCrossVMCall` that ran the EVM call inside it ("Retire now"). */
      tx: { lane: "evm" | "native"; hash: string };
      txStatus: "success" | "reverted";
      receipts: Counts;
      retirements: Counts;
      asExpected: boolean;
      evidenceCase: string;
    }
  | { kind: "fallback"; action: DemoAction; reason: FallbackReason; retryAfterSeconds?: number; evmTx?: string; evidenceCase: string };

/** Reasons the page can explain. Anything else the server says is shown as "unavailable". */
export const FALLBACK_REASONS = [
  "disabled",
  "unavailable",
  "low-funds",
  "busy",
  "daily-limit",
  "ip-limit",
  "timeout",
  "send-failed",
  "unreachable",
] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

export type DemoFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ status: number; json(): Promise<unknown> }>;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCounts = (v: unknown): v is Counts => isObj(v) && isNum(v.before) && isNum(v.after);
const isHash = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const isCosmosHash = (v: unknown): v is string => typeof v === "string" && /^[0-9A-F]{64}$/.test(v);

/** The sent transaction in a server answer: `evmTx`, or `cosmosTx` for a call sent from the Native lane. */
function sentTx(body: Record<string, unknown>): { lane: "evm" | "native"; hash: string } | null {
  if (isHash(body.evmTx) && body.cosmosTx === undefined) return { lane: "evm", hash: body.evmTx };
  if (isCosmosHash(body.cosmosTx) && body.evmTx === undefined) return { lane: "native", hash: body.cosmosTx };
  return null;
}

/** Demo status, or null when the server cannot be reached or answers something else. */
export async function readStatus(fetchFn: DemoFetch, base: string): Promise<DemoStatus | null> {
  try {
    const res = await fetchFn(`${base}/status`);
    const b = res.status === 200 ? await res.json() : null;
    if (!isObj(b) || typeof b.enabled !== "boolean" || typeof b.ready !== "boolean") return null;
    return {
      enabled: b.enabled,
      ready: b.ready,
      busy: b.busy === true,
      remainingToday: isNum(b.remainingToday) ? b.remainingToday : 0,
      remainingForYou: isNum(b.remainingForYou) ? b.remainingForYou : 0,
    };
  } catch {
    return null;
  }
}

/** Sends one demo transaction through the server. Never throws: every failure becomes a fallback to the recorded case. */
export async function runDemo(fetchFn: DemoFetch, base: string, action: DemoAction): Promise<DemoOutcome> {
  const def = DEMO_ACTIONS.find((a) => a.action === action)!;
  const fallback = (reason: FallbackReason, extra: { retryAfterSeconds?: number; evmTx?: string } = {}): DemoOutcome => ({
    kind: "fallback",
    action,
    reason,
    ...extra,
    evidenceCase: def.evidenceCase,
  });
  let body: unknown;
  try {
    const res = await fetchFn(base + def.path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    body = await res.json();
  } catch {
    return fallback("unreachable");
  }
  if (!isObj(body)) return fallback("unavailable");
  if (body.ok === true) {
    const status = body.txStatus;
    const tx = sentTx(body);
    if (!tx || (status !== "success" && status !== "reverted") || !isCounts(body.receipts) || !isCounts(body.retirements)) {
      return fallback("unavailable");
    }
    return {
      kind: "sent",
      action,
      expect: def.expect,
      tx,
      txStatus: status,
      receipts: body.receipts,
      retirements: body.retirements,
      asExpected: body.asExpected === true,
      evidenceCase: def.evidenceCase,
    };
  }
  const reason = (FALLBACK_REASONS as readonly unknown[]).includes(body.reason) ? (body.reason as FallbackReason) : "unavailable";
  const extra: { retryAfterSeconds?: number; evmTx?: string } = {};
  if (isNum(body.retryAfterSeconds)) extra.retryAfterSeconds = body.retryAfterSeconds;
  if (isHash(body.evmTx)) extra.evmTx = body.evmTx;
  return fallback(reason, extra);
}

/**
 * When the last status already says live sends cannot run, the page shows the recorded case without asking the
 * server again. Returns null when a send should be tried.
 */
export function knownFallback(status: DemoStatus | null | "loading", action: DemoAction): DemoOutcome | null {
  if (status === null || status === "loading") return null;
  const reason: FallbackReason | null = !status.enabled ? "disabled" : !status.ready ? "unavailable" : null;
  if (!reason) return null;
  return { kind: "fallback", action, reason, evidenceCase: DEMO_ACTIONS.find((a) => a.action === action)!.evidenceCase };
}
