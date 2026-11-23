import type { PqcKeypair } from "@qorechain/sdk";
import type { Hex } from "viem";
import { evmKey, keyFileObject, readKeyFile } from "../keyfile.js";
import { pqcKeypair } from "../native.js";

/**
 * The demo sender's keys (account 7), in one file in the read-only key folder:
 *
 * {
 *   "privateKey": "0x<32-byte EVM private key of the demo account>",
 *   "pqcSecretKey": "0x<its registered ML-DSA-87 secret key>",
 *   "pqcPublicKey": "0x<the matching ML-DSA-87 public key>"
 * }
 *
 * It pays gas for the demo buttons and holds the certificates they retire and grant. It is not the meter run's
 * sender, so the two never race for the same nonce. The two ML-DSA-87 fields go together and are needed only to
 * send "Retire now" from the Native lane (decision 0026); without them the demo sends everything as EVM transactions.
 */
export const DEMO_KEY_FILE = "demo-sender.json";

export interface DemoKey {
  privateKey: Hex;
  /** Null when the file has no ML-DSA-87 key: the Native route is then not available. */
  pqc: PqcKeypair | null;
}

/** The keys, or null when the file is not there yet. A file that is there but wrong is an error. */
export function readDemoKey(dir: string | undefined): DemoKey | null {
  const raw = readKeyFile(dir, DEMO_KEY_FILE);
  return raw === null ? null : parseDemoKey(raw);
}

export function parseDemoKey(raw: string): DemoKey {
  const o = keyFileObject(raw, DEMO_KEY_FILE);
  const privateKey = evmKey(o.privateKey, `${DEMO_KEY_FILE} privateKey`);
  const hasPqc = o.pqcSecretKey !== undefined || o.pqcPublicKey !== undefined;
  return { privateKey, pqc: hasPqc ? pqcKeypair(o, DEMO_KEY_FILE) : null };
}
