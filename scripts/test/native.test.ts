import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MSG_SEND_TYPE_URL,
  deriveUnifiedAccount,
  generatePqcKeypair,
  verifyProofOfPossession,
  type EvmWindow,
  type PqcKeypair,
  type PqcStatus,
} from "@qorechain/sdk";
import { bytesToHex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Lane } from "../src/lane.js";
import {
  actorFrom,
  closeWindow,
  feeFor,
  fundAccounts,
  openWindow,
  readStatus,
  registerKey,
  toUqor,
  type Actor,
  type Ctx,
  type NativeSettings,
  type SignRequest,
} from "../src/native.js";
import { indexOf } from "../testnet.js";
import { nativeRoles } from "../native.js";

/** Frozen settings, so a change to config/app.json never turns these tests red. */
const SETTINGS: NativeSettings = {
  nativeLane: {
    denom: "uqor",
    decimals: 6,
    gasPriceUqor: "0.15",
    gas: { send: 400_000, registerKey: 500_000, openWindow: 400_000, closeWindow: 300_000 },
    waitSeconds: 1,
    pollSeconds: 1,
  },
  funding: {
    funder: "funder",
    keepOnFunderQor: "20",
    lowBalanceQor: "8",
    lowBalanceRoles: ["funder", "sender"],
    targetsQor: { meter: "1", sender: "15" },
  },
  windows: { deploy: { role: "funder", blocks: 3600, maxTxs: 30, maxValueQor: "8" } },
};
const CHAIN_ID = "fixture-chain";
const Q = 1_000_000n;

interface SentTx extends SignRequest {
  from: string;
}

const closedWindow = (): EvmWindow => ({
  found: false,
  live: false,
  openedHeight: 0n,
  expiryHeight: 0n,
  maxTxs: 0n,
  usedTxs: 0n,
  maxValue: 0n,
  usedValue: 0n,
  remainingBlocks: 0n,
  remainingTxs: 0n,
  remainingValue: 0n,
  nativeOnly: false,
  allowedTargets: [],
});

/**
 * An in-memory Native lane. Signed bytes are the JSON of the sign request; the lane applies the messages the way the
 * chain does for these steps, and refuses a hybrid tx from an account with no key or a classical tx that is not a key
 * registration, so a wrong signing mode shows up as a failed test.
 */
class FakeLane implements Lane {
  balances = new Map<string, bigint>();
  seq = new Map<string, bigint>();
  keys = new Map<string, PqcStatus>();
  windows = new Map<string, EvmWindow>();
  sent: SentTx[] = [];
  height = 100n;

  async account(a: string) {
    return this.balances.has(a) ? { accountNumber: 1n, sequence: this.seq.get(a) ?? 0n } : undefined;
  }
  async balance(a: string) {
    return this.balances.get(a) ?? 0n;
  }
  async pqcStatus(a: string) {
    return this.keys.get(a) ?? { registered: false };
  }
  async window(a: string) {
    const w = this.windows.get(a);
    return w ? { ...w } : closedWindow();
  }
  async broadcast(bytes: Uint8Array) {
    const tx = JSON.parse(new TextDecoder().decode(bytes), (_k, v) =>
      typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v,
    ) as SentTx;
    const from = tx.from;
    if (BigInt(tx.sequence) !== (this.seq.get(from) ?? 0n)) throw new Error("wrong sequence");
    const registering = tx.messages.every((m) => m.typeUrl.endsWith("MsgRegisterPQCKeyV2"));
    if (tx.classical !== registering) throw new Error("wrong signing mode");
    if (!tx.classical && !this.keys.get(from)?.registered) throw new Error("no key");
    const fee = BigInt(tx.fee.amount[0]!.amount);
    this.balances.set(from, (this.balances.get(from) ?? 0n) - fee);
    for (const m of tx.messages) {
      const v = m.value as Record<string, any>;
      if (m.typeUrl === MSG_SEND_TYPE_URL) {
        const amt = BigInt(v.amount[0].amount);
        this.balances.set(from, this.balances.get(from)! - amt);
        this.balances.set(v.toAddress, (this.balances.get(v.toAddress) ?? 0n) + amt);
      } else if (registering) {
        this.keys.set(from, { registered: true, algorithmId: 1, pubkey: bytesToHex(v.publicKey), possessionProven: true });
      } else if (m.typeUrl.endsWith("MsgOpenEVMWindow")) {
        this.windows.set(from, {
          ...closedWindow(),
          found: true,
          live: true,
          expiryHeight: this.height + BigInt(v.blocks),
          remainingBlocks: BigInt(v.blocks),
          remainingTxs: BigInt(v.maxTxs),
          remainingValue: BigInt(v.maxValue),
        });
      } else if (m.typeUrl.endsWith("MsgCloseEVMWindow")) {
        this.windows.delete(from);
      }
    }
    this.seq.set(from, (this.seq.get(from) ?? 0n) + 1n);
    this.sent.push(tx);
    return { hash: `HASH${this.sent.length}`, height: Number(this.height), gasUsed: 1 };
  }
}

function fakeActor(role: string, pqc: PqcKeypair = generatePqcKeypair(new Uint8Array(32).fill(role.length))): Actor {
  const cosmos = `qor1${role}`;
  return {
    role,
    cosmos,
    ecdsaPubkey: new Uint8Array(),
    pqc,
    sign: (r) =>
      new TextEncoder().encode(
        JSON.stringify({ ...r, from: cosmos }, (_k, v) =>
          typeof v === "bigint" ? `${v}n` : v instanceof Uint8Array ? Array.from(v) : v,
        ),
      ),
  };
}

let lane: FakeLane;
let ctx: Ctx;
let logs: string[];
const funder = fakeActor("funder");
const meter = fakeActor("meter");
const sender = fakeActor("sender");

beforeEach(() => {
  lane = new FakeLane();
  logs = [];
  ctx = { lane, chainId: CHAIN_ID, settings: SETTINGS, log: (l) => logs.push(l) };
});

describe("amounts and fees", () => {
  it("prices a fee from the gas limit and the gas price, rounded up", () => {
    expect(feeFor(SETTINGS.nativeLane, "send")).toEqual({ amount: [{ denom: "uqor", amount: "60000" }], gas: "400000" });
    expect(feeFor({ ...SETTINGS.nativeLane, gasPriceUqor: "0.125", gas: { ...SETTINGS.nativeLane.gas, send: 3 } }, "send", 2))
      .toEqual({ amount: [{ denom: "uqor", amount: "1" }], gas: "6" });
  });

  it("reads plain decimal QOR amounts only", () => {
    expect(toUqor("1.5", 6)).toBe(1_500_000n);
    for (const bad of ["-1", "1e3", "", "0x10"]) expect(() => toUqor(bad, 6)).toThrow(/not a QOR amount/);
  });
});

describe("fundAccounts", () => {
  it("registers the funder's key, tops up only what is short in one tx, and sends nothing on a second run", async () => {
    lane.balances.set(funder.cosmos, 60n * Q);
    lane.balances.set(meter.cosmos, 2n * Q);
    await fundAccounts(ctx, funder, [meter, sender]);
    expect(lane.sent.map((t) => t.classical)).toEqual([true, false]);
    expect(lane.sent[1]!.messages).toHaveLength(1);
    expect(lane.balances.get(sender.cosmos)).toBe(15n * Q);
    expect(lane.balances.get(meter.cosmos)).toBe(2n * Q);

    const before = lane.sent.length;
    expect(await fundAccounts(ctx, funder, [meter, sender])).toBeUndefined();
    expect(lane.sent).toHaveLength(before);
  });

  it("refuses before sending anything when the funder would end below what it keeps", async () => {
    lane.balances.set(funder.cosmos, 35n * Q);
    await expect(fundAccounts(ctx, funder, [meter, sender])).rejects.toThrow(/must stay/);
    expect(lane.sent).toHaveLength(0);
  });

  it("refuses a recipient with no target in the config", async () => {
    lane.balances.set(funder.cosmos, 60n * Q);
    await expect(fundAccounts(ctx, funder, [fakeActor("stranger")])).rejects.toThrow(/no "stranger"/);
  });
});

describe("registerKey", () => {
  it("registers classically with a proof of possession for this account and chain, then reads it back", async () => {
    lane.balances.set(meter.cosmos, Q);
    expect(await registerKey(ctx, meter)).toBe("HASH1");
    const v = lane.sent[0]!.messages[0]!.value as Record<string, unknown>;
    const proof = Uint8Array.from(v.proofOfPossession as number[]);
    const ok = (account: string, chainId: string) =>
      verifyProofOfPossession({ chainId, account, publicKey: meter.pqc.publicKey, proof });
    expect(ok(meter.cosmos, CHAIN_ID)).toBe(true);
    expect(ok(sender.cosmos, CHAIN_ID)).toBe(false);
    expect(ok(meter.cosmos, "other-chain")).toBe(false);
    expect(await registerKey(ctx, meter)).toBeUndefined();
    expect(lane.sent).toHaveLength(1);
  });

  it("stops without sending when another key is registered", async () => {
    lane.balances.set(meter.cosmos, Q);
    const other = generatePqcKeypair(new Uint8Array(32).fill(9));
    lane.keys.set(meter.cosmos, { registered: true, algorithmId: 1, pubkey: bytesToHex(other.publicKey) });
    await expect(registerKey(ctx, meter)).rejects.toThrow(/another ML-DSA-87 key/);
    expect(lane.sent).toHaveLength(0);
  });

  it("fails when the chain reports the key unproven after registering", async () => {
    lane.balances.set(meter.cosmos, Q);
    const broadcast = lane.broadcast.bind(lane);
    lane.broadcast = async (b) => {
      const r = await broadcast(b);
      lane.keys.set(meter.cosmos, { ...lane.keys.get(meter.cosmos)!, possessionProven: false });
      return r;
    };
    await expect(registerKey(ctx, meter)).rejects.toThrow(/did not leave a proven key/);
  });

  it("says an account with no funds has none instead of signing", async () => {
    await expect(registerKey(ctx, meter)).rejects.toThrow(/has no funds yet/);
  });
});

describe("EVM window", () => {
  beforeEach(async () => {
    lane.balances.set(funder.cosmos, 30n * Q);
    await registerKey(ctx, funder);
  });

  it("opens the configured window hybrid-signed, with the value bound in uqor", async () => {
    await openWindow(ctx, funder, "deploy");
    const tx = lane.sent.at(-1)!;
    expect(tx.classical).toBe(false);
    expect(tx.messages[0]!.value).toMatchObject({ blocks: "3600", maxTxs: "30", maxValue: "8000000", allowedTargets: [] });
    expect((await lane.window(funder.cosmos)).live).toBe(true);
  });

  it("keeps a live unscoped window that is wide enough", async () => {
    await openWindow(ctx, funder, "deploy");
    const n = lane.sent.length;
    expect(await openWindow(ctx, funder, "deploy")).toBeUndefined();
    expect(lane.sent).toHaveLength(n);
  });

  it("opens a new window over a scoped one, which would refuse contract creation", async () => {
    lane.windows.set(funder.cosmos, {
      ...closedWindow(),
      found: true,
      live: true,
      remainingTxs: 100n,
      remainingValue: 100n * Q,
      allowedTargets: ["0x0000000000000000000000000000000000000901"],
    });
    expect(await openWindow(ctx, funder, "deploy")).toBeDefined();
  });

  it("refuses a window for another role or one not in the config", async () => {
    await expect(openWindow(ctx, sender, "deploy")).rejects.toThrow(/belongs to funder/);
    await expect(openWindow(ctx, funder, "nope")).rejects.toThrow(/no "nope"/);
  });

  it("closes a live window and does nothing when none is open", async () => {
    expect(await closeWindow(ctx, funder)).toBeUndefined();
    await openWindow(ctx, funder, "deploy");
    expect(await closeWindow(ctx, funder)).toBeDefined();
    expect((await lane.window(funder.cosmos)).live).toBe(false);
  });
});

describe("readStatus", () => {
  it("flags only watched accounts below the low-balance line", async () => {
    lane.balances.set(funder.cosmos, 7n * Q);
    lane.balances.set(meter.cosmos, 0n);
    lane.balances.set(sender.cosmos, 8n * Q);
    const rows = await readStatus(ctx, [funder, meter, sender]);
    expect(rows.map((r) => [r.role, r.low])).toEqual([
      ["funder", true],
      ["meter", false],
      ["sender", false],
    ]);
  });
});

describe("real signer", () => {
  const MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

  it("signs eth-native txs; the hybrid one carries the ML-DSA-87 signature, the classical one does not", async () => {
    const actor = actorFrom("funder", await deriveUnifiedAccount(MNEMONIC, 0), CHAIN_ID, "v2");
    expect(actor.ecdsaPubkey).toHaveLength(33);
    const req = { messages: [], fee: feeFor(SETTINGS.nativeLane, "send"), accountNumber: 5n, sequence: 2n };
    const hybrid = actor.sign({ ...req, classical: false });
    const classical = actor.sign({ ...req, classical: true });
    expect(hybrid.length - classical.length).toBeGreaterThanOrEqual(4627);
  });
});

describe("config/app.json", () => {
  const app = JSON.parse(readFileSync(fileURLToPath(new URL("../../config/app.json", import.meta.url)), "utf8"));

  it("names one account for every role the native command and its windows act for", () => {
    const s = app as NativeSettings;
    for (const role of [...nativeRoles(s), ...Object.values(s.windows).map((w) => w.role)])
      expect(() => indexOf(app, role)).not.toThrow();
    for (const q of [s.funding.keepOnFunderQor, s.funding.lowBalanceQor, ...Object.values(s.funding.targetsQor)])
      expect(() => toUqor(q, s.nativeLane.decimals)).not.toThrow();
  });
});
