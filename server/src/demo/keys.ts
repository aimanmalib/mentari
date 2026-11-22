import type { Hex } from "viem";
import { evmKey, keyFileObject, readKeyFile } from "../keyfile.js";

/**
 * The demo sender's key (account 7), in one file in the read-only key folder:
 *
 * { "privateKey": "0x<32-byte EVM private key of the demo account>" }
 *
 * It pays gas for the demo buttons and holds the certificates they retire and grant. It is not the meter run's
 * sender, so the two never race for the same nonce.
 */
export const DEMO_KEY_FILE = "demo-sender.json";

/** The key, or null when the file is not there yet. A file that is there but wrong is an error. */
export function readDemoKey(dir: string | undefined): Hex | null {
  const raw = readKeyFile(dir, DEMO_KEY_FILE);
  return raw === null ? null : parseDemoKey(raw);
}

export function parseDemoKey(raw: string): Hex {
  return evmKey(keyFileObject(raw, DEMO_KEY_FILE).privateKey, `${DEMO_KEY_FILE} privateKey`);
}
