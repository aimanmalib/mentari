import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { METER_KEYS_FILE, parseMeterKeys, readMeterKeys } from "../src/meter/keys.js";

/** Throwaway values shaped like keys. They sign nothing anywhere. */
const SENDER = `0x${"1f".repeat(32)}`;
const METER = "0x00000000000000000000000000000000000000a1";
const PQC = `0x${"ab".repeat(4896)}`;
const valid = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ sender: SENDER, meters: [{ address: METER, pqcSecretKey: PQC }], ...over });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function folder(content?: string): string {
  const d = mkdtempSync(join(tmpdir(), "mentari-keys-"));
  dirs.push(d);
  if (content !== undefined) writeFileSync(join(d, METER_KEYS_FILE), content);
  return d;
}

describe("readMeterKeys", () => {
  it("is null when no folder is set or the file is not there yet", () => {
    expect(readMeterKeys(undefined)).toBeNull();
    expect(readMeterKeys("")).toBeNull();
    expect(readMeterKeys(folder())).toBeNull();
  });

  it("reads the sender and one key per checksummed meter address", () => {
    const keys = readMeterKeys(folder(valid()))!;
    expect(keys.sender).toBe(SENDER);
    expect([...keys.meters.keys()]).toEqual(["0x00000000000000000000000000000000000000A1"]);
    expect(keys.meters.get("0x00000000000000000000000000000000000000A1")!.length).toBe(4896);
  });
});

describe("parseMeterKeys", () => {
  const bad: [string, string, RegExp][] = [
    ["not JSON", "{", /not valid JSON/],
    ["a list", "[]", /expected an object/],
    ["a short sender", valid({ sender: `0x${"1f".repeat(31)}` }), /sender: expected a 32-byte hex key/],
    ["a sender without 0x", valid({ sender: "1f".repeat(32) }), /sender: expected a 32-byte hex key/],
    ["no meters", valid({ meters: [] }), /meters: expected a non-empty list/],
    ["a bad address", valid({ meters: [{ address: "0x12", pqcSecretKey: PQC }] }), /meters\[0\]\.address/],
    ["a short ML-DSA key", valid({ meters: [{ address: METER, pqcSecretKey: `0x${"ab".repeat(100)}` }] }), /pqcSecretKey: expected 4896 bytes/],
    ["a non-hex ML-DSA key", valid({ meters: [{ address: METER, pqcSecretKey: `0x${"zz".repeat(4896)}` }] }), /pqcSecretKey/],
    [
      "a meter listed twice",
      valid({ meters: [{ address: METER, pqcSecretKey: PQC }, { address: METER.toUpperCase().replace("0X", "0x"), pqcSecretKey: PQC }] }),
      /meters\[1\]\.address: listed twice/,
    ],
  ];
  it.each(bad)("refuses %s and names the field, never the value", (_name, raw, message) => {
    let err: Error | undefined;
    try {
      parseMeterKeys(raw);
    } catch (e) {
      err = e as Error;
    }
    expect(err?.message).toMatch(message);
    expect(err!.message).not.toContain("1f1f1f");
    expect(err!.message).not.toContain("abab");
  });
});
