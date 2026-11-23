import {
  EthNativeSigner,
  ML_DSA_87_PUBLIC_KEY_LENGTH,
  ML_DSA_87_SECRET_KEY_LENGTH,
  addressesFrom20,
  resolveSignBytesVersion,
  type PqcKeypair,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { hexToBytes, isHex, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { restLane, type Fetch } from "../../scripts/src/lane.js";
import { crossVmCallMsg } from "../../scripts/src/native-entry.js";
import { feeForGas } from "../../scripts/src/native.js";

/**
 * Calls into an EVM contract sent from the Native lane (decision 0025): one hybrid-signed (secp256k1 + ML-DSA-87)
 * `MsgCrossVMCall` per call, which needs no EVM window. The case H test showed the chain runs it, nested bridge call
 * included, in one Native transaction. Keys come from the read-only key folder and stay in this process.
 */

/** The Native lane as `config/app.json` describes it. */
export interface NativeLaneConfig {
  chainId: string;
  rest: string;
  denom: string;
  gasPriceUqor: string;
  /** Longest wait for the transaction to be in a block, and the time between looks. */
  waitMs: number;
  pollMs: number;
}

/** A sender's two keys: the eth_secp256k1 key it shares with its EVM address, and its registered ML-DSA-87 key. */
export interface NativeKey {
  privateKey: Hex;
  pqc: PqcKeypair;
}

export interface NativeCall {
  contract: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  /** Gas limit. The fee is this limit at the configured price, whatever the call uses. */
  gas: number;
}

/** A call that was put in a block. `reverted` = the EVM call failed there and changed nothing. */
export interface NativeCallResult {
  cosmosTx: string;
  status: "success" | "reverted";
  height: number;
  gasUsed: number | null;
}

export interface NativeCaller {
  /** The sender's `qor1…` address. */
  readonly address: string;
  /** Sign and send one call, and wait until it is in a block. Throws when the node refuses it before any block. */
  call(c: NativeCall): Promise<NativeCallResult>;
}

/** The 33-byte compressed form of an uncompressed (0x04…) secp256k1 public key. */
export function compressPublicKey(uncompressed: Hex): Hex {
  const b = hexToBytes(uncompressed);
  if (b.length !== 65 || b[0] !== 4) throw new Error("expected a 65-byte uncompressed public key");
  const prefix = (b[64]! & 1) === 0 ? "02" : "03";
  return `0x${prefix}${uncompressed.slice(4, 68)}`;
}

/** The SDK account shape for a sender known by its keys alone (no seed phrase in the server). */
export function accountFromKey(key: NativeKey): UnifiedAccount {
  const evm = privateKeyToAccount(key.privateKey);
  return {
    ...addressesFrom20(hexToBytes(evm.address)),
    privateKey: key.privateKey,
    publicKey: compressPublicKey(evm.publicKey),
    pqc: key.pqc,
  };
}

/** An ML-DSA-87 key pair from a key file's two hex fields, or an error naming `where`, never the value. */
export function pqcKeypair(o: Record<string, unknown>, where: string): PqcKeypair {
  const bytes = (field: string, length: number): Uint8Array => {
    const v = o[field];
    if (!isHex(v, { strict: true }) || (v.length - 2) / 2 !== length)
      throw new Error(`${where}.${field}: expected ${length} bytes of hex`);
    return hexToBytes(v);
  };
  return {
    secretKey: bytes("pqcSecretKey", ML_DSA_87_SECRET_KEY_LENGTH),
    publicKey: bytes("pqcPublicKey", ML_DSA_87_PUBLIC_KEY_LENGTH),
  };
}

export function nativeCaller(
  cfg: NativeLaneConfig,
  key: NativeKey,
  deps: {
    fetch?: Fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): NativeCaller {
  const account = accountFromKey(key);
  const lane = restLane({
    rest: cfg.rest,
    denom: cfg.denom,
    waitMs: cfg.waitMs,
    pollMs: cfg.pollMs,
    ...deps,
  });
  return {
    address: account.cosmos,
    async call(c) {
      const signBytesVersion = await resolveSignBytesVersion({
        chainId: cfg.chainId,
        rest: cfg.rest,
        ...(deps.fetch ? { fetch: deps.fetch as never } : {}),
      });
      const signer = new EthNativeSigner(account, {
        signMode: "hybrid",
        signBytesVersion,
      });
      const seq = await lane.account(account.cosmos);
      if (!seq) throw new Error(`${account.cosmos} has no funds`);
      const msg = crossVmCallMsg(account.cosmos, c.contract, c.abi, c.functionName, c.args);
      const { txRawBytes } = signer.sign({
        chainId: cfg.chainId,
        messages: [msg],
        fee: feeForGas(cfg, BigInt(c.gas)),
        accountNumber: seq.accountNumber,
        sequence: seq.sequence,
      });
      const r = await lane.submit(txRawBytes);
      if (r.stage === "check") throw new Error(`${c.functionName} refused before a block: ${r.codespace} code ${r.code}`);
      return {
        cosmosTx: r.hash,
        status: r.code === 0 ? "success" : "reverted",
        height: r.height!,
        gasUsed: r.gasUsed,
      };
    },
  };
}
