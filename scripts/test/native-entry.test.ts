import { decodeFunctionData, parseAbi, toFunctionSelector, type Address } from "viem";
import { describe, expect, it } from "vitest";
import type { Submitted } from "../src/lane.js";
import {
  CROSS_VM_CALL_TYPE_URL,
  crossVmCallMsg,
  entrySteps,
  mergeSteps,
  runStep,
  type NativeEntryConfig,
  type StepEnv,
  type StepRecord,
  type StepSpec,
} from "../src/native-entry.js";
import type { SignRequest } from "../src/native.js";

const ABI = parseAbi([
  "function attest(uint32 id, uint32 day, uint64 wh, bytes sig)",
  "function retire(uint256 wh, string memo) returns (uint256, uint64)",
]);
const CONTRACT = "0x00000000000000000000000000000000000000aa" as Address;
const SENDER = "qor1fixturesender";
const CFG: NativeEntryConfig = { role: "buyer", system: 3, retireWh: 500, memo: "Native entry E1", gas: 2_000_000, stockWh: 1000 };

const steps = (freeDay: number | null) =>
  entrySteps({ cfg: CFG, freeDay, firstDay: 20777, whFor: (d) => d - 20000, sign: () => "0xabcd" });

function env(over: Partial<StepEnv> & { answer?: Submitted; signed?: SignRequest[] } = {}): StepEnv {
  let reads = 0;
  const signed = over.signed ?? [];
  return {
    actor: {
      role: "buyer",
      cosmos: SENDER,
      sign: (r) => {
        signed.push(r);
        return new Uint8Array([1]);
      },
    },
    submitter: { submit: async () => over.answer ?? included(0) },
    account: async () => ({ accountNumber: 4n, sequence: 9n }),
    windowLive: async () => false,
    mentari: { address: CONTRACT, abi: ABI },
    probe: async () => ({ retirementsCount: String(reads++) }),
    receiptsAt: async (h) => h,
    revertReason: async () => "AlreadyAttested(3, 20777)",
    lane: { denom: "uqor", gasPriceUqor: "0.15" },
    gas: CFG.gas,
    ...over,
  };
}

function included(code: number, log = ""): Submitted {
  return {
    hash: "AB12",
    stage: "block",
    code,
    codespace: code ? "crossvm" : "",
    log,
    height: 77,
    gasUsed: 123,
    events: [{ type: "tx", attributes: [] }, { type: "tx", attributes: [] }, { type: "message", attributes: [] }],
  };
}

describe("crossVmCallMsg", () => {
  it("is a MsgCrossVMCall into the EVM contract, signed by the sender, carrying the ABI call", () => {
    const m = crossVmCallMsg(SENDER, CONTRACT, ABI, "retire", [500n, "memo"]);
    expect(m.typeUrl).toBe(CROSS_VM_CALL_TYPE_URL);
    const v = m.value as { sender: string; targetVm: string; targetContract: string; payload: Uint8Array; async: boolean };
    expect([v.sender, v.targetVm, v.targetContract, v.async]).toEqual([SENDER, "evm", CONTRACT, false]);
    const data = `0x${Buffer.from(v.payload).toString("hex")}` as const;
    expect(data.slice(0, 10)).toBe(toFunctionSelector("retire(uint256,string)"));
    expect(decodeFunctionData({ abi: ABI, data }).args).toEqual([500n, "memo"]);
  });
});

describe("entrySteps", () => {
  it("attests the free day when there is one, and retires in step 2", () => {
    const [one, two] = steps(20780);
    expect(one!.args.slice(0, 3)).toEqual([3, 20780, 780n]);
    expect(one!.contractWould).toBe("mint the reading");
    expect([two!.functionName, two!.args]).toEqual(["retire", [500n, "Native entry E1"]]);
  });

  it("sends the first day again when every day has a reading, expecting AlreadyAttested", () => {
    const [one] = steps(null);
    expect(one!.args.slice(0, 3)).toEqual([3, 20777, 777n]);
    expect(one!.contractWould).toBe("revert AlreadyAttested");
  });
});

describe("runStep", () => {
  const spec = steps(null)[1]! as StepSpec;

  it("signs one hybrid MsgCrossVMCall at the configured gas and records an accepted call", async () => {
    const signed: SignRequest[] = [];
    const r = await runStep(env({ signed }), spec);
    expect(signed).toHaveLength(1);
    expect(signed[0]!.classical).toBe(false);
    expect([signed[0]!.accountNumber, signed[0]!.sequence]).toEqual([4n, 9n]);
    expect(signed[0]!.fee).toEqual({ amount: [{ denom: "uqor", amount: "300000" }], gas: "2000000" });
    expect(signed[0]!.messages[0]!.typeUrl).toBe(CROSS_VM_CALL_TYPE_URL);
    expect(r).toMatchObject({ accepted: true, stage: "block", height: 77, cosmos_tx: "AB12", event_types: ["tx", "message"] });
    expect(r.state).toEqual([{ name: "retirementsCount", before: "0", after: "1" }]);
    expect([r.receipts, r.revert_reason]).toEqual([{ before: 76, after: 77 }, null]);
  });

  it("records a call that fails in the block as not accepted, with the chain's log", async () => {
    const r = await runStep(env({ answer: included(5, "no EVM window") }), spec);
    expect(r).toMatchObject({ accepted: false, code: 5, codespace: "crossvm", log: "no EVM window" });
    expect(r.revert_reason).toBe("AlreadyAttested(3, 20777)");
  });

  it("records a refusal before any block: no height, not accepted", async () => {
    const answer: Submitted = { ...included(13, "x".repeat(700)), stage: "check", height: null };
    const r = await runStep(env({ answer }), spec);
    expect([r.accepted, r.stage, r.height, r.receipts]).toEqual([false, "check", null, null]);
    expect(r.log).toHaveLength(601);
  });

  it("sends nothing while the sender has a live EVM window", async () => {
    const signed: SignRequest[] = [];
    await expect(runStep(env({ signed, windowLive: async () => true }), spec)).rejects.toThrow(/live EVM window/);
    expect(signed).toHaveLength(0);
  });

  it("shortens long arguments such as a signature", async () => {
    const r = await runStep(env(), { ...steps(null)[0]!, args: [3, 20777, 777n, `0x${"ab".repeat(100)}`] });
    expect(r.args).toEqual(["3", "20777", "777", "0xabababababababab…(100 bytes)"]);
  });
});

describe("mergeSteps", () => {
  it("keeps earlier steps and replaces a step that ran again", () => {
    const rec = (step: 1 | 2, cosmos_tx: string) => ({ step, cosmos_tx }) as StepRecord;
    expect(mergeSteps([rec(2, "B"), rec(1, "A")], [rec(1, "C")]).map((s) => [s.step, s.cosmos_tx])).toEqual([
      [1, "C"],
      [2, "B"],
    ]);
  });
});
