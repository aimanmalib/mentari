import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isHex, type Hex } from "viem";

/**
 * Key files live in the read-only key folder (`MENTARI_SECRETS_DIR`), written outside the repository once the
 * contracts are deployed. The image never holds them. Every error names the file and the field, never the value.
 */

/** The file's text, or null when the folder is not set or the file is not there yet. */
export function readKeyFile(dir: string | undefined, file: string): string | null {
  if (!dir) return null;
  try {
    return readFileSync(join(dir, file), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${file}: cannot read (${(err as NodeJS.ErrnoException).code ?? "error"})`);
  }
}

/** The top-level JSON object of a key file. */
export function keyFileObject(raw: string, file: string): Record<string, unknown> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${file}: not valid JSON`);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error(`${file}: expected an object`);
  return json as Record<string, unknown>;
}

/** A 32-byte EVM private key, or an error naming `where`. */
export function evmKey(v: unknown, where: string): Hex {
  if (!isHex(v, { strict: true }) || v.length !== 66) throw new Error(`${where}: expected a 32-byte hex key`);
  return v;
}
