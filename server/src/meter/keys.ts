import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ML_DSA_87_SECRET_KEY_LENGTH } from "@qorechain/sdk";
import { getAddress, hexToBytes, isHex, type Address, type Hex } from "viem";

/**
 * Keys for the daily meter run. They live in one file in the read-only key folder (`MENTARI_SECRETS_DIR`),
 * written outside the repository once the contracts are deployed. The image never holds them.
 *
 * {
 *   "sender": "0x<32-byte EVM private key that pays gas for the attest calls>",
 *   "meters": [{ "address": "0x<meter account>", "pqcSecretKey": "0x<ML-DSA-87 secret key of that account>" }]
 * }
 *
 * The sender only pays gas: `attest` checks the meter's ML-DSA-87 signature, not who sends it. It must not be the
 * demo sender, so the two never race for the same nonce. Errors name the field, never the value.
 */
export const METER_KEYS_FILE = "meter-keys.json";

export interface MeterKeys {
  sender: Hex;
  /** Checksummed meter address to its ML-DSA-87 secret key. */
  meters: Map<Address, Uint8Array>;
}

/** The keys, or null when the file is not there yet. A file that is there but wrong is an error. */
export function readMeterKeys(dir: string | undefined): MeterKeys | null {
  if (!dir) return null;
  let raw: string;
  try {
    raw = readFileSync(join(dir, METER_KEYS_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${METER_KEYS_FILE}: cannot read (${(err as NodeJS.ErrnoException).code ?? "error"})`);
  }
  return parseMeterKeys(raw);
}

export function parseMeterKeys(raw: string): MeterKeys {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${METER_KEYS_FILE}: not valid JSON`);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json))
    throw new Error(`${METER_KEYS_FILE}: expected an object`);
  const o = json as Record<string, unknown>;
  const sender = o.sender;
  if (!isHex(sender, { strict: true }) || sender.length !== 66)
    throw new Error(`${METER_KEYS_FILE} sender: expected a 32-byte hex key`);
  if (!Array.isArray(o.meters) || o.meters.length === 0)
    throw new Error(`${METER_KEYS_FILE} meters: expected a non-empty list`);
  const meters = new Map<Address, Uint8Array>();
  o.meters.forEach((m: unknown, i: number) => {
    const where = `${METER_KEYS_FILE} meters[${i}]`;
    const e = (typeof m === "object" && m !== null ? m : {}) as Record<string, unknown>;
    let address: Address;
    try {
      address = getAddress(String(e.address));
    } catch {
      throw new Error(`${where}.address: expected an EVM address`);
    }
    const key = e.pqcSecretKey;
    if (!isHex(key, { strict: true }) || (key.length - 2) / 2 !== ML_DSA_87_SECRET_KEY_LENGTH)
      throw new Error(`${where}.pqcSecretKey: expected ${ML_DSA_87_SECRET_KEY_LENGTH} bytes of hex`);
    if (meters.has(address)) throw new Error(`${where}.address: listed twice`);
    meters.set(address, hexToBytes(key));
  });
  return { sender, meters };
}
