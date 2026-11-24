import { describe, expect, it } from "vitest";
import { classicAttempt, nodeMessage, type ClassicEnv, type Holdings } from "../src/classic-only.js";

const CFG = { retireWh: 500, memo: "Classic key only", waitSeconds: 6 };
const HOLD: Holdings = { nonce: 6, certificates: "1000", retirementsCount: "30" };

function env(over: Partial<ClassicEnv> & { after?: Holdings; receipts?: ("success" | "reverted" | null)[] } = {}) {
  const calls = { sent: [] as string[], signedAt: [] as number[], polls: 0, sleeps: 0 };
  let reads = 0;
  const receipts = [...(over.receipts ?? [])];
  const e: ClassicEnv = {
    windowLive: async () => false,
    holdings: async () => (reads++ === 0 ? HOLD : (over.after ?? HOLD)),
    ethCall: async () => "the same call succeeds as an eth_call",
    signClassic: async (nonce) => {
      calls.signedAt.push(nonce);
      return { raw: "0x02aa", hash: "0xfeed" };
    },
    sendRaw: async (raw) => {
      calls.sent.push(raw);
      throw new Error("the chain says no\nURL: https://rpc\nRequest body: {…}");
    },
    receipt: async () => {
      calls.polls++;
      return receipts.shift() ?? null;
    },
    sleep: async () => {
      calls.sleeps++;
    },
    pollMs: 2000,
    ...over,
  };
  return { e, calls };
}

describe("classicAttempt", () => {
  it("records a refused send: the node's message, no receipt, nonce and holdings unchanged", async () => {
    const { e, calls } = env();
    const r = await classicAttempt(e, CFG);
    expect(calls.signedAt).toEqual([6]);
    expect(calls.sent).toEqual(["0x02aa"]);
    expect(calls.polls).toBe(1);
    expect(r).toMatchObject({
      evm_tx: "0xfeed",
      signed_with: "secp256k1 only",
      rpc_error: "the chain says no",
      receipt_found: false,
      receipt_status: null,
      refused: true,
      args: ["500", "Classic key only"],
      before: HOLD,
      after: HOLD,
    });
  });

  it("does not call a taken transaction refused when a receipt appears, even a reverted one", async () => {
    const { e, calls } = env({ sendRaw: async () => "0xfeed", receipts: [null, "reverted"] });
    const r = await classicAttempt(e, CFG);
    expect([r.rpc_error, r.receipt_found, r.receipt_status, r.refused]).toEqual([null, true, "reverted", false]);
    expect([calls.polls, calls.sleeps]).toEqual([2, 1]);
  });

  it("waits waitSeconds for a receipt, and still not refused when the nonce moved", async () => {
    const { e, calls } = env({ sendRaw: async () => "0xfeed", after: { ...HOLD, nonce: 7 } });
    const r = await classicAttempt(e, CFG);
    expect(calls.polls).toBe(3);
    expect([r.receipt_found, r.refused]).toEqual([false, false]);
  });

  it("sends nothing while the sender has a live EVM window", async () => {
    const { e, calls } = env({ windowLive: async () => true });
    await expect(classicAttempt(e, CFG)).rejects.toThrow(/live EVM window/);
    expect(calls.sent).toEqual([]);
  });
});

describe("nodeMessage", () => {
  it("prefers viem's details, keeps one line, and caps the length", () => {
    expect(nodeMessage({ details: "invalid tx: no window", message: "long dump" })).toBe("invalid tx: no window");
    expect(nodeMessage(new Error("first\nsecond"))).toBe("first");
    expect(nodeMessage(new Error("x".repeat(500)))).toHaveLength(401);
  });
});
