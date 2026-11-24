import { encodeFunctionData, hexToBytes, type Address } from "viem";
import { mentariWalletAbi } from "../data/abi.js";

/**
 * The two Native messages the wallet path hands to QoreX, protobuf-encoded in the page. QoreX `signAndBroadcast`
 * takes a type URL and the message bytes, and adds the hybrid secp256k1 + ML-DSA-87 signature itself. The field
 * numbers are the chain's (`qorechain.crossvm.v1.MsgCrossVMCall`, `cosmos.bank.v1beta1.MsgSend`); a scripts test
 * checks these bytes against the encoders in `@qorechain/sdk`. Kept here so the site does not ship the whole SDK.
 */
export const CROSS_VM_CALL_TYPE_URL = "/qorechain.crossvm.v1.MsgCrossVMCall";
export const MSG_SEND_TYPE_URL = "/cosmos.bank.v1beta1.MsgSend";

export interface EncodedMessage {
  typeUrl: string;
  value: Uint8Array;
}

class Writer {
  readonly #parts: number[] = [];

  varint(n: number): this {
    let v = n >>> 0;
    while (v > 0x7f) {
      this.#parts.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.#parts.push(v);
    return this;
  }

  bytes(field: number, value: Uint8Array): this {
    if (value.length === 0) return this;
    this.varint((field << 3) | 2).varint(value.length);
    for (const b of value) this.#parts.push(b);
    return this;
  }

  string(field: number, value: string): this {
    return this.bytes(field, new TextEncoder().encode(value));
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.#parts);
  }
}

/** `Mentari.retire(wh, memo)` called from the Native lane: the EVM `msg.sender` is the sender's own EVM address. */
export function retireCall(sender: string, contract: Address, wh: bigint, memo: string): EncodedMessage {
  const data = encodeFunctionData({ abi: mentariWalletAbi, functionName: "retire", args: [wh, memo] });
  const value = new Writer()
    .string(1, sender)
    // source_vm is ignored by the chain; the server's "Retire now" sends the same value.
    .string(2, "cosmwasm")
    .string(3, "evm")
    .string(4, contract)
    .bytes(5, hexToBytes(data))
    .finish();
  return { typeUrl: CROSS_VM_CALL_TYPE_URL, value };
}

/** A bank send of `amount` to the sender itself: the first QoreX transaction registers the account's ML-DSA-87 key. */
export function selfSend(address: string, denom: string, amount: string): EncodedMessage {
  const coin = new Writer().string(1, denom).string(2, amount).finish();
  const value = new Writer().string(1, address).string(2, address).bytes(3, coin).finish();
  return { typeUrl: MSG_SEND_TYPE_URL, value };
}
