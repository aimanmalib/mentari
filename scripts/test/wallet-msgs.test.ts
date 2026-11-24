import { bank, crossvm, qorechainRegistry } from "@qorechain/sdk";
import { encodeFunctionData, hexToBytes, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { mentariWalletAbi } from "../../web/src/data/abi.js";
import { CROSS_VM_CALL_TYPE_URL, MSG_SEND_TYPE_URL, retireCall, selfSend } from "../../web/src/wallet/nativeMsgs.js";

/** The site encodes the two wallet messages itself; these must be the bytes the SDK the server uses would produce. */
const registry = qorechainRegistry();
const SENDER = "qor1nhh5zsnhyag9f06ct6hpe34yk2m8xputtw4t63";
const CONTRACT = "0x5Bd3D6a4E4c2bC0a9F1a3e7c1b0d2E6f8A9b7C3d" as Address;

describe("wallet messages built in the page", () => {
  it("encodes Mentari.retire as the SDK's MsgCrossVMCall", () => {
    const memo = "from QoreX · ünïcode";
    const ours = retireCall(SENDER, CONTRACT, 500n, memo);
    const data = encodeFunctionData({ abi: mentariWalletAbi, functionName: "retire", args: [500n, memo] });
    const sdkMsg = crossvm.crossVmCall({ sender: SENDER, sourceVm: "cosmwasm", targetVm: "evm", targetContract: CONTRACT, payload: hexToBytes(data) });
    expect(ours.typeUrl).toBe(CROSS_VM_CALL_TYPE_URL);
    expect(sdkMsg.typeUrl).toBe(CROSS_VM_CALL_TYPE_URL);
    expect(Buffer.from(ours.value).toString("hex")).toBe(Buffer.from(registry.encode(sdkMsg as never)).toString("hex"));
  });

  it("encodes a long memo (multi-byte length prefix) the same way", () => {
    const memo = "m".repeat(300);
    const ours = retireCall(SENDER, CONTRACT, 123456789n, memo);
    const data = encodeFunctionData({ abi: mentariWalletAbi, functionName: "retire", args: [123456789n, memo] });
    const sdkMsg = crossvm.crossVmCall({ sender: SENDER, sourceVm: "cosmwasm", targetVm: "evm", targetContract: CONTRACT, payload: hexToBytes(data) });
    expect(Buffer.from(ours.value).equals(Buffer.from(registry.encode(sdkMsg as never)))).toBe(true);
  });

  it("encodes the key-registration self send as the SDK's MsgSend", () => {
    const ours = selfSend(SENDER, "uqor", "1");
    const sdkMsg = bank.send({ fromAddress: SENDER, toAddress: SENDER, amount: [{ denom: "uqor", amount: "1" }] });
    expect(ours.typeUrl).toBe(MSG_SEND_TYPE_URL);
    expect(sdkMsg.typeUrl).toBe(MSG_SEND_TYPE_URL);
    expect(Buffer.from(ours.value).toString("hex")).toBe(Buffer.from(registry.encode(sdkMsg as never)).toString("hex"));
  });
});
