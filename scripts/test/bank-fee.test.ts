import { readFileSync } from "node:fs";
import { MSG_SEND_TYPE_URL } from "@qorechain/sdk";
import { describe, expect, it } from "vitest";
import { BANK_FEE_MESSAGES, bankChecks, bankFeeSpecs, bankReader, feeMsg, runBankFee, type BankFeeConfig, type BankFeeEnv, type BankReader } from "../src/bank-fee.js";
import type { Submitted } from "../src/lane.js";
import { CROSS_VM_CALL_TYPE_URL } from "../src/native-entry.js";
import type { SignRequest } from "../src/native.js";

const CFG: BankFeeConfig = { role: "buyer", to: "registrar", feeUqor: "100000", retireWh: 500, memo: "Case J", gas: 1700000, stockWh: 1000 };
const MENTARI = "0x00000000000000000000000000000000000000Aa" as const;
const ABI = [
  {
    type: "function",
    name: "retire",
    stateMutability: "nonpayable",
    inputs: [{ name: "wh", type: "uint256" }, { name: "memo", type: "string" }],
    outputs: [],
  },
] as const;

function env(answer: Partial<Submitted>, balances: Record<number, bigint> = { 99: 5_000_000n, 100: 5_100_000n }) {
  const signed: SignRequest[] = [];
  const reads: number[] = [];
  const bank: BankReader = {
    balanceAt: async (_a, _d, h) => {
      reads.push(h);
      return balances[h] ?? 0n;
    },
    messageTypes: async () => null,
  };
  const e: BankFeeEnv = {
    actor: {
      role: "buyer",
      cosmos: "qor1buyer",
      sign: (r) => {
        signed.push(r);
        return new Uint8Array([1]);
      },
    },
    submitter: {
      submit: async () => ({ hash: "AB12", stage: "block", code: 0, codespace: "", log: "", height: 100, gasUsed: 1, events: [], ...answer }),
    },
    account: async () => ({ accountNumber: 7n, sequence: 3n }),
    windowLive: async () => false,
    mentari: { address: MENTARI, abi: ABI },
    probe: async () => ({ retirementsCount: "22" }),
    receiptsAt: async (h) => (h >= 100 ? 31 : 30),
    revertReason: async () => "InsufficientBalance",
    lane: { denom: "uqor", gasPriceUqor: "0.15" },
    gas: CFG.gas,
    bank,
    fee: feeMsg("qor1buyer", "qor1registrar", "uqor", CFG.feeUqor),
    to: { role: "registrar", cosmos: "qor1registrar" },
    denom: "uqor",
    amount: CFG.feeUqor,
  };
  return { e, signed, reads };
}

describe("runBankFee", () => {
  it("signs the fee transfer and the retire into one hybrid transaction, fee first", async () => {
    const { e, signed } = env({});
    const [j] = bankFeeSpecs(CFG, 0n);
    await runBankFee(e, j!.spec);
    expect(signed).toHaveLength(1);
    expect(signed[0]!.classical).toBe(false);
    expect(signed[0]!.messages.map((m) => m.typeUrl)).toEqual(BANK_FEE_MESSAGES);
    expect(BANK_FEE_MESSAGES).toEqual([MSG_SEND_TYPE_URL, CROSS_VM_CALL_TYPE_URL]);
    expect(signed[0]!.messages[0]!.value).toEqual({ fromAddress: "qor1buyer", toAddress: "qor1registrar", amount: [{ denom: "uqor", amount: "100000" }] });
    expect(signed[0]!.fee.gas).toBe("1700000");
  });

  it("reads the recipient's balance at the block before and at the transaction's block", async () => {
    const { e, reads } = env({});
    const r = await runBankFee(e, bankFeeSpecs(CFG, 0n)[0]!.spec);
    expect(reads).toEqual([99, 100]);
    expect(r.bank).toEqual({ to: { role: "registrar", cosmos: "qor1registrar" }, denom: "uqor", amount: "100000", before: "5000000", after: "5100000" });
    expect(r.step.accepted).toBe(true);
    expect(r.step.receipts).toEqual({ before: 30, after: 31 });
  });

  it("records no balances when the node refuses the transaction before any block", async () => {
    const { e, reads } = env({ stage: "check", code: 4, height: null });
    const r = await runBankFee(e, bankFeeSpecs(CFG, 0n)[0]!.spec);
    expect(r.bank).toBeNull();
    expect(reads).toEqual([]);
    expect(r.step.revert_reason).toBe("InsufficientBalance");
  });
});

describe("bankFeeSpecs", () => {
  it("J retires the configured amount; J2 asks for one Wh more than the sender holds", () => {
    const [j, j2] = bankFeeSpecs(CFG, 500n);
    expect(j!.id).toBe("J");
    expect(j!.spec.args).toEqual([500n, "Case J"]);
    expect(j2!.id).toBe("J2");
    expect(j2!.spec.args).toEqual([501n, "Case J"]);
    expect(j2!.spec.contractWould).toMatch(/revert/);
  });
});

const entry = (id: string, accepted: boolean, height: number | null = 100) => ({
  id,
  messages: BANK_FEE_MESSAGES,
  bank: { to: { role: "registrar", cosmos: "qor1registrar" }, denom: "uqor", amount: "100000", before: "0", after: "0" },
  steps: [{ step: 1, function: "retire", cosmos_tx: `TX${id}`, height, accepted }],
});

function reader(balances: Record<number, bigint>, types: string[] | null = BANK_FEE_MESSAGES): BankReader {
  return {
    balanceAt: async (_a, _d, h) => {
      if (!(h in balances)) throw new Error("pruned");
      return balances[h]!;
    },
    messageTypes: async () => types,
  };
}

describe("bankChecks", () => {
  it("passes J when the fee arrived in its block and J2 when the balance did not move", async () => {
    const checks = await bankChecks(reader({ 99: 1n, 100: 100_001n, 199: 7n, 200: 7n }), [entry("J", true, 100), entry("J2", false, 200)]);
    expect(checks.map((c) => c.outcome)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(checks[0]!.name).toBe("case J one transaction carries MsgSend + MsgCrossVMCall");
    expect(checks[3]!.name).toBe("case J2 registrar balance unchanged at block 200");
  });

  it("fails J when the fee did not arrive, and J2 when the fee stayed paid", async () => {
    const checks = await bankChecks(reader({ 99: 1n, 100: 1n, 199: 7n, 200: 100_007n }), [entry("J", true, 100), entry("J2", false, 200)]);
    expect(checks.filter((c) => c.outcome === "fail").map((c) => c.name)).toEqual([
      "case J registrar balance gained the fee of 100000 uqor at block 100",
      "case J2 registrar balance unchanged at block 200",
    ]);
  });

  it("fails when the transaction carries other messages, and is unavailable when the node cannot answer", async () => {
    const wrong = await bankChecks(reader({ 99: 1n, 100: 100_001n }, [CROSS_VM_CALL_TYPE_URL]), [entry("J", true)]);
    expect(wrong[0]!.outcome).toBe("fail");
    const gone = await bankChecks(reader({}, null), [entry("J", true)]);
    expect(gone.map((c) => c.outcome)).toEqual(["unavailable", "unavailable"]);
  });

  it("skips cases without a bank record", async () => {
    expect(await bankChecks(reader({}), [{ id: "H", steps: [] }, { id: "A", evm_tx: "0x1" }])).toEqual([]);
  });
});

describe("bankReader", () => {
  it("asks for the balance at the block height and reads message types from the transaction", async () => {
    const seen: { url: string; height: string | undefined }[] = [];
    const f = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url, height: init?.headers?.["x-cosmos-block-height"] });
      const body = url.includes("/balances/")
        ? { balance: { denom: "uqor", amount: "42" } }
        : { tx: { body: { messages: [{ "@type": MSG_SEND_TYPE_URL }, { "@type": CROSS_VM_CALL_TYPE_URL }] } } };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const r = bankReader({ rest: "https://rest/", fetch: f });
    expect(await r.balanceAt("qor1x", "uqor", 10)).toBe(42n);
    expect(await r.messageTypes("AB")).toEqual(BANK_FEE_MESSAGES);
    expect(seen[0]).toEqual({ url: "https://rest/cosmos/bank/v1beta1/balances/qor1x/by_denom?denom=uqor", height: "10" });
    expect(seen[1]!.url).toBe("https://rest/cosmos/tx/v1beta1/txs/AB");
  });
});

describe("config/app.json bankFee", () => {
  it("names two different roles that exist and a positive whole-uqor fee", () => {
    const app = JSON.parse(readFileSync(new URL("../../config/app.json", import.meta.url), "utf8"));
    const roles = Object.values(app.accounts);
    expect(roles).toContain(app.bankFee.role);
    expect(roles).toContain(app.bankFee.to);
    expect(app.bankFee.to).not.toBe(app.bankFee.role);
    expect(app.bankFee.feeUqor).toMatch(/^[1-9]\d*$/);
  });
});
