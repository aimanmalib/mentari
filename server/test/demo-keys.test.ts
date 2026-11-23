import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_KEY_FILE, parseDemoKey, readDemoKey } from "../src/demo/keys.js";

/** A throwaway value shaped like a key. It signs nothing anywhere. */
const KEY = `0x${"2e".repeat(32)}`;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function folder(content?: string): string {
  const d = mkdtempSync(join(tmpdir(), "mentari-demo-key-"));
  dirs.push(d);
  if (content !== undefined) writeFileSync(join(d, DEMO_KEY_FILE), content);
  return d;
}

describe("readDemoKey", () => {
  it("is null when no folder is set or the file is not there yet", () => {
    expect(readDemoKey(undefined)).toBeNull();
    expect(readDemoKey(folder())).toBeNull();
  });

  it("reads the private key, with no ML-DSA-87 key when the file has none", () => {
    expect(readDemoKey(folder(JSON.stringify({ privateKey: KEY })))).toEqual({
      privateKey: KEY,
      pqc: null,
    });
  });

  it("reads the ML-DSA-87 key pair beside it", () => {
    const pqc = {
      pqcSecretKey: `0x${"5a".repeat(4896)}`,
      pqcPublicKey: `0x${"5b".repeat(2592)}`,
    };
    const key = readDemoKey(folder(JSON.stringify({ privateKey: KEY, ...pqc })));
    expect(key?.pqc?.secretKey).toHaveLength(4896);
    expect(key?.pqc?.publicKey).toHaveLength(2592);
  });
});

describe("parseDemoKey", () => {
  it.each([
    ["not JSON", "{", /not valid JSON/],
    ["a list", "[]", /expected an object/],
    ["no key", "{}", /privateKey: expected a 32-byte hex key/],
    ["a short key", JSON.stringify({ privateKey: "0x1234" }), /privateKey/],
    ["a key without 0x", JSON.stringify({ privateKey: "2e".repeat(32) }), /privateKey/],
    [
      "half an ML-DSA-87 pair",
      JSON.stringify({
        privateKey: KEY,
        pqcSecretKey: `0x${"2e".repeat(4896)}`,
      }),
      /pqcPublicKey: expected 2592 bytes/,
    ],
  ])("refuses %s and never repeats the value", (_name, raw, message) => {
    let err: Error | undefined;
    try {
      parseDemoKey(raw);
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toMatch(message);
    expect(err?.message).not.toContain("2e2e");
  });
});
