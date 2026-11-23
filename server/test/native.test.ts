import { deriveUnifiedAccount, type UnifiedAccount } from "@qorechain/sdk";
import { encodeFunctionData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import { mentariDemoAbi } from "../src/abi.js";
import { accountFromKey, compressPublicKey, nativeCaller, pqcKeypair, type NativeLaneConfig } from "../src/native.js";

/** A public test phrase: its accounts hold nothing anywhere. */
const MNEMONIC = "test test test test test test test test test test test junk";
const REST = "https://rest.example.test";
const LANE: NativeLaneConfig = {
  chainId: "fixture-1",
  rest: REST,
  denom: "uqor",
  gasPriceUqor: "0.15",
  waitMs: 1000,
  pollMs: 1,
};
const MENTARI = "0x00000000000000000000000000000000000000c3";
const HASH = "8E15D319B2971FC5102C027BA8E3C8A8AAF1FDD72AD8E2172CEE2303B453B40A";
const CALL = {
  contract: MENTARI,
  abi: mentariDemoAbi,
  functionName: "retire",
  args: [500n, "fixture memo"],
  gas: 1_300_000,
} as const;

let account: UnifiedAccount;
beforeAll(async () => {
  account = await deriveUnifiedAccount(MNEMONIC, 7);
});

/** A REST node that knows one account and answers a broadcast with `check`, then the tx with `block`. */
function node(check: { code: number; codespace?: string }, block: { code: number; height?: string; gas_used?: string }) {
  const posted: string[] = [];
  const f = async (url: string, init?: { method?: string; body?: string }) => {
    let status = 200;
    let body: unknown;
    if (url === `${REST}/cosmos/auth/v1beta1/accounts/${account.cosmos}`) {
      body = {
        account: { base_account: { account_number: "41", sequence: "9" } },
      };
    } else if (url === `${REST}/cosmos/tx/v1beta1/txs` && init?.method === "POST") {
      posted.push(JSON.parse(init.body!).tx_bytes as string);
      body = {
        tx_response: {
          txhash: HASH,
          code: check.code,
          codespace: check.codespace ?? "",
          raw_log: "fixture",
        },
      };
    } else if (url === `${REST}/cosmos/tx/v1beta1/txs/${HASH}`) {
      body = {
        tx_response: {
          txhash: HASH,
          height: "10613003",
          gas_used: "1009253",
          raw_log: "",
          ...block,
        },
      };
    } else {
      status = 404;
      body = { code: 5, message: "not found" };
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { posted, fetch: f as unknown as typeof fetch };
}

describe("accountFromKey", () => {
  it("rebuilds the same account from the two keys alone: addresses and compressed public key", () => {
    const a = accountFromKey({
      privateKey: account.privateKey as Hex,
      pqc: account.pqc,
    });
    expect(a.cosmos).toBe(account.cosmos);
    expect(a.evm).toBe(account.evm);
    expect(a.publicKey).toBe(account.publicKey);
    expect(a.pqc).toBe(account.pqc);
  });

  it("compresses with the prefix of the y coordinate's parity", () => {
    const pub = privateKeyToAccount(account.privateKey as Hex).publicKey;
    const c = compressPublicKey(pub);
    expect(c).toBe(account.publicKey);
    expect(c.slice(4)).toBe(pub.slice(4, 68));
    expect(() => compressPublicKey("0x02")).toThrow(/65-byte/);
  });
});

describe("pqcKeypair", () => {
  const hex = (b: Uint8Array) => `0x${Buffer.from(b).toString("hex")}`;

  it("reads both fields, and names the field, never the value, when one is wrong", () => {
    const o = {
      pqcSecretKey: hex(account.pqc.secretKey),
      pqcPublicKey: hex(account.pqc.publicKey),
    };
    expect(pqcKeypair(o, "f.json")).toEqual({
      secretKey: account.pqc.secretKey,
      publicKey: account.pqc.publicKey,
    });
    expect(() => pqcKeypair({ ...o, pqcPublicKey: undefined }, "f.json")).toThrow(/f.json.pqcPublicKey: expected 2592 bytes/);
    const short = { ...o, pqcSecretKey: o.pqcSecretKey.slice(0, 100) };
    expect(() => pqcKeypair(short, "f.json")).toThrow(/f.json.pqcSecretKey: expected 4896 bytes/);
    try {
      pqcKeypair(short, "f.json");
    } catch (e) {
      expect((e as Error).message).not.toContain(o.pqcSecretKey.slice(2, 40));
    }
  });
});

describe("nativeCaller", () => {
  const key = () => ({
    privateKey: account.privateKey as Hex,
    pqc: account.pqc,
  });

  it("signs one hybrid MsgCrossVMCall carrying the EVM call and reports it mined", async () => {
    const n = node({ code: 0 }, { code: 0 });
    const caller = nativeCaller(LANE, key(), {
      fetch: n.fetch,
      sleep: async () => undefined,
    });
    expect(caller.address).toBe(account.cosmos);
    const r = await caller.call(CALL);
    expect(r).toEqual({
      cosmosTx: HASH,
      status: "success",
      height: 10613003,
      gasUsed: 1009253,
    });

    expect(n.posted).toHaveLength(1);
    const tx = Buffer.from(n.posted[0]!, "base64");
    const calldata = encodeFunctionData({
      abi: mentariDemoAbi,
      functionName: "retire",
      args: [500n, "fixture memo"],
    });
    expect(tx.includes(Buffer.from(calldata.slice(2), "hex"))).toBe(true);
    expect(tx.includes(Buffer.from("/qorechain.crossvm.v1.MsgCrossVMCall"))).toBe(true);
    expect(tx.includes(Buffer.from(account.cosmos))).toBe(true);
    // The fee is the whole gas limit at 0.15 uqor: 1,300,000 x 0.15 = 195,000.
    expect(tx.includes(Buffer.from("195000"))).toBe(true);
    // Hybrid: the ML-DSA-87 signature (4,627 bytes) rides along with the secp256k1 one.
    expect(tx.length).toBeGreaterThan(4627);
  });

  it("reports a call that reverted inside its block, so the ledgers can be compared", async () => {
    const n = node({ code: 0 }, { code: 7 });
    const r = await nativeCaller(LANE, key(), {
      fetch: n.fetch,
      sleep: async () => undefined,
    }).call(CALL);
    expect(r.status).toBe("reverted");
    expect(r.cosmosTx).toBe(HASH);
  });

  it("throws when the node refuses the call before any block", async () => {
    const n = node({ code: 21, codespace: "pqc" }, { code: 0 });
    await expect(nativeCaller(LANE, key(), { fetch: n.fetch }).call(CALL)).rejects.toThrow(/refused before a block: pqc code 21/);
  });

  it("sends nothing for an account the chain has not seen", async () => {
    const other = await deriveUnifiedAccount(MNEMONIC, 8);
    const n = node({ code: 0 }, { code: 0 });
    const caller = nativeCaller(LANE, { privateKey: other.privateKey as Hex, pqc: other.pqc }, { fetch: n.fetch });
    await expect(caller.call(CALL)).rejects.toThrow(/has no funds/);
    expect(n.posted).toHaveLength(0);
  });
});
