import { createHash } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import { decodeFunctionData, toHex } from "viem";
import app from "../../config/app.json" with { type: "json" };
import { mentariWalletAbi } from "../src/data/abi.js";
import { CROSS_VM_CALL_TYPE_URL } from "../src/wallet/nativeMsgs.js";
import { nativeToEvm } from "../src/data/address.js";
import type { FakeChain } from "./fake-chain.js";

const REGISTER_KEY = "/qorechain.pqc.v1.MsgRegisterPQCKeyV2";
const HYBRID = "/qorechain.pqc.v1.PQCHybridSignature";

/** A Native transaction the fake REST endpoint has seen: its hash and messages, decoded. */
export interface NativeTx {
  hash: string;
  messages: { typeUrl: string; value: Uint8Array }[];
}

/** Length-delimited fields of one protobuf message, by field number. Enough for TxRaw, TxBody and Any. */
function fields(buf: Uint8Array): Map<number, Uint8Array[]> {
  const out = new Map<number, Uint8Array[]>();
  let i = 0;
  const varint = () => {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = buf[i++]!;
      v += (b & 0x7f) * 2 ** shift;
      if (b < 0x80) return v;
      shift += 7;
    }
  };
  while (i < buf.length) {
    const key = varint();
    const wire = key & 7;
    if (wire === 0) varint();
    else if (wire === 2) {
      const len = varint();
      const list = out.get(key >>> 3) ?? [];
      list.push(buf.subarray(i, i + len));
      out.set(key >>> 3, list);
      i += len;
    } else throw new Error(`fake native: wire type ${wire} not handled`);
  }
  return out;
}

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b ?? new Uint8Array());

/**
 * A stand-in for the testnet REST endpoint the QoreX wallet mock talks to: account numbers, the PQC key lookup,
 * broadcast and the committed transaction. It runs what the page asked QoreX to send against `FakeChain`: a key
 * registration makes the account quantum ready; a `MsgCrossVMCall` into `Mentari.retire` retires from it. Nothing
 * leaves the test machine. The key lookup always answers "not registered", so the mock registers before each send.
 */
export class FakeNative {
  readonly txs: NativeTx[] = [];
  /** False: the account does not exist on the chain yet (never funded). */
  funded = true;

  constructor(readonly chain: FakeChain) {}

  async install(page: Page): Promise<void> {
    await page.route(`${app.network.rest.replace(/\/$/, "")}/**`, (route) => this.#handle(route));
  }

  async #handle(route: Route): Promise<void> {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" };
    const reply = (status: number, json: unknown) => route.fulfill({ status, headers: cors, contentType: "application/json", json });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname;
    if (path.startsWith("/cosmos/auth/v1beta1/account_info/")) {
      if (!this.funded) return reply(404, { code: 5, message: "account not found" });
      return reply(200, { info: { account_number: "42", sequence: String(this.txs.length) } });
    }
    if (path.startsWith("/qorechain/pqc/v1/account/")) return reply(200, { found: false });
    if (path.startsWith("/cosmos/upgrade/v1beta1/applied_plan/")) return reply(200, { height: "0" });
    if (path === "/cosmos/tx/v1beta1/txs" && req.method() === "POST") {
      const raw = Buffer.from((req.postDataJSON() as { tx_bytes: string }).tx_bytes, "base64");
      return reply(200, { tx_response: { txhash: this.#run(raw), code: 0, codespace: "", raw_log: "" } });
    }
    if (path.startsWith("/cosmos/tx/v1beta1/txs/")) {
      const hash = path.split("/").pop()!;
      if (!this.txs.some((t) => t.hash === hash)) return reply(404, {});
      return reply(200, { tx_response: { code: 0, height: "20" }, tx: { body: { extension_options: [{ "@type": HYBRID }] } } });
    }
    return reply(501, { message: `fake native: ${req.method()} ${path} not handled` });
  }

  #run(raw: Uint8Array): string {
    const hash = createHash("sha256").update(raw).digest("hex").toUpperCase();
    const body = fields(raw).get(1)?.[0] ?? new Uint8Array();
    const messages = (fields(body).get(1) ?? []).map((any) => {
      const f = fields(any);
      return { typeUrl: text(f.get(1)?.[0]), value: f.get(2)?.[0] ?? new Uint8Array() };
    });
    this.txs.push({ hash, messages });
    for (const m of messages) {
      if (m.typeUrl === REGISTER_KEY) this.chain.quantumReady = true;
      if (m.typeUrl === CROSS_VM_CALL_TYPE_URL) {
        const f = fields(m.value);
        const call = decodeFunctionData({ abi: mentariWalletAbi, data: toHex(f.get(5)![0]!) });
        // The EVM msg.sender of a Native call is the signer's own bytes: the message's sender, in EVM form.
        if (call.functionName === "retire") this.chain.retireFromNative(nativeToEvm(text(f.get(1)?.[0])), call.args[0] as bigint);
      }
    }
    return hash;
  }

  /** The `MsgCrossVMCall` messages sent, decoded: sender, target and the Mentari call. */
  crossVmCalls() {
    return this.txs.flatMap((t) =>
      t.messages
        .filter((m) => m.typeUrl === CROSS_VM_CALL_TYPE_URL)
        .map((m) => {
          const f = fields(m.value);
          const call = decodeFunctionData({ abi: mentariWalletAbi, data: toHex(f.get(5)![0]!) });
          return { sender: text(f.get(1)?.[0]), targetVm: text(f.get(3)?.[0]), contract: text(f.get(4)?.[0]), call: { functionName: call.functionName, args: call.args } };
        }),
    );
  }

  typeUrls(): string[][] {
    return this.txs.map((t) => t.messages.map((m) => m.typeUrl));
  }
}
