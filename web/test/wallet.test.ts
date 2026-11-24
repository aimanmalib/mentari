import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mentariWalletAbi } from "../src/data/abi.js";
import { requestGrant } from "../src/data/grant.js";
import { classifyWalletError } from "../src/wallet/errors.js";

const SOL = readFileSync(new URL("../../contracts/src/Mentari.sol", import.meta.url), "utf8");
const entry = (name: string) => mentariWalletAbi.find((e) => e.name === name)!;
const types = (params: string) =>
  params
    .split(",")
    .map((p) => p.trim().split(/\s+/)[0])
    .filter(Boolean);

describe("the wallet ABI matches contracts/src/Mentari.sol", () => {
  it.each(["retire", "isQuantumReady"])("%s has the same inputs and outputs", (name) => {
    const m = SOL.match(new RegExp(`function ${name}\\(([^)]*)\\)[^{;]*?(?:returns \\(([^)]*)\\))?\\s*\\{`));
    expect(m, `function ${name} not found`).not.toBeNull();
    const fn = entry(name) as { inputs: readonly { type: string }[]; outputs: readonly { type: string }[] };
    expect(types(m![1]!)).toEqual(fn.inputs.map((i) => i.type));
    expect(types(m![2] ?? "")).toEqual(fn.outputs.map((o) => o.type));
  });

  it("reads balanceOf from the public mapping", () => {
    expect(SOL).toMatch(/mapping\(address => uint256\) public balanceOf;/);
  });

  it.each(["ZeroAmount", "InsufficientBalance", "NotQuantumReady"])("error %s has the same fields", (name) => {
    const params = SOL.match(new RegExp(`error ${name}\\(([^)]*)\\);`))?.[1];
    expect(params, `error ${name} not found`).toBeDefined();
    expect(types(params!)).toEqual((entry(name) as { inputs: readonly { type: string }[] }).inputs.map((i) => i.type));
  });
});

type Call = { url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: Call["init"]) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return { status, json: async () => body };
  };
  return { fn, calls };
}

const WALLET = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const HASH = `0x${"c".repeat(64)}`;

describe("requestGrant", () => {
  it("posts JSON to the grant route for the wallet and returns the hash", async () => {
    const f = fakeFetch(200, { ok: true, action: "grant", to: WALLET, wh: 500, evmTx: HASH });
    expect(await requestGrant(f.fn, "/api/demo", WALLET)).toEqual({ kind: "sent", lane: "evm", hash: HASH, wh: 500 });
    const cosmosTx = "E405CBAB".padEnd(64, "C");
    const n = fakeFetch(200, { ok: true, action: "grant", to: WALLET, wh: 500, cosmosTx });
    expect(await requestGrant(n.fn, "/api/demo", WALLET)).toEqual({ kind: "sent", lane: "native", hash: cosmosTx, wh: 500 });
    expect(f.calls).toEqual([
      { url: `/api/demo/grant/${WALLET}`, init: { method: "POST", headers: { "content-type": "application/json" }, body: "{}" } },
    ]);
  });

  it("passes on a known refusal with its wait", async () => {
    const f = fakeFetch(429, { ok: false, reason: "ip-limit", retryAfterSeconds: 120 });
    expect(await requestGrant(f.fn, "/api/demo", WALLET)).toEqual({ kind: "refused", reason: "ip-limit", retryAfterSeconds: 120 });
  });

  it("explains the receiver rule", async () => {
    const f = fakeFetch(409, { ok: false, reason: "not-quantum-ready" });
    expect(await requestGrant(f.fn, "/api/demo", WALLET)).toEqual({ kind: "refused", reason: "not-quantum-ready" });
  });

  it.each([
    ["an unknown reason", { ok: false, reason: "teapot" }],
    ["a success without a hash", { ok: true, wh: 500, evmTx: "0x12" }],
    ["a success with both hashes", { ok: true, wh: 500, evmTx: `0x${"a".repeat(64)}`, cosmosTx: "A".repeat(64) }],
    ["a non-object", "nope"],
  ])("treats %s as unavailable", async (_what, body) => {
    expect(await requestGrant(fakeFetch(200, body).fn, "/api/demo", WALLET)).toEqual({ kind: "refused", reason: "unavailable" });
  });

  it("never sends for a malformed address", async () => {
    const f = fakeFetch(200, {});
    expect(await requestGrant(f.fn, "/api/demo", "0x12/../retire")).toEqual({ kind: "refused", reason: "unavailable" });
    expect(f.calls).toEqual([]);
  });

  it("reports a network error as unreachable", async () => {
    const fn = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await requestGrant(fn, "/api/demo", WALLET)).toEqual({ kind: "refused", reason: "unreachable" });
  });
});

describe("classifyWalletError", () => {
  const wrapped = (inner: object) => ({ message: "Transaction failed", cause: { message: "outer", cause: inner } });

  it("reads QoreX's refusal of EVM signing, today without a code", () => {
    expect(classifyWalletError(wrapped({ message: "QoreX: EVM method eth_sendTransaction not yet supported" }))).toBe("unsupported");
  });

  it("reads QoreX's own refusal wording, which has no code", () => {
    expect(classifyWalletError(wrapped({ message: "QoreX: signature rejected" }))).toBe("declined");
    expect(classifyWalletError(wrapped({ message: "QoreX: connection rejected" }))).toBe("declined");
  });

  it("reads the announced code 4200", () => {
    expect(classifyWalletError({ code: 4200, message: "x" })).toBe("unsupported");
  });

  it("reads a declined request", () => {
    expect(classifyWalletError(wrapped({ code: 4001, message: "User rejected the request." }))).toBe("declined");
  });

  it.each([
    ["NotQuantumReady", 'The contract function "retire" reverted.\nError: NotQuantumReady(address account)', "not-quantum-ready"],
    ["InsufficientBalance", "Error: InsufficientBalance(uint256 balance, uint256 needed)", "insufficient"],
  ] as const)("reads the contract error %s", (_n, shortMessage, want) => {
    expect(classifyWalletError({ message: "reverted", shortMessage })).toBe(want);
  });

  it("calls anything else a failure", () => {
    expect(classifyWalletError(new Error("socket hang up"))).toBe("failed");
    expect(classifyWalletError(undefined)).toBe("failed");
  });
});
