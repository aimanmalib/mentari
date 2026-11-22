import { bech32 } from "@scure/base";
import { describe, expect, it } from "vitest";
import { evmToNative, shorten } from "../src/data/address.js";

describe("evmToNative", () => {
  it("encodes the same 20 bytes under the Native prefix", () => {
    const address = "0x5e1a00000000000000000000000000000000c0de";
    const native = evmToNative(address, "qor");
    expect(native.startsWith("qor1")).toBe(true);
    const decoded = bech32.decode(native as `${string}1${string}`);
    const hex = Array.from(bech32.fromWords(decoded.words), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(`0x${hex}`).toBe(address);
  });

  it("ignores the checksum case of the EVM address", () => {
    expect(evmToNative("0xABCDEF0000000000000000000000000000000001", "qor")).toBe(
      evmToNative("0xabcdef0000000000000000000000000000000001", "qor"),
    );
  });

  it.each(["", "0x1234", "0xzz00000000000000000000000000000000000000", "5e1a00000000000000000000000000000000c0de00"])(
    "rejects %j",
    (bad) => {
      expect(() => evmToNative(bad, "qor")).toThrow();
    },
  );
});

describe("shorten", () => {
  it("keeps the head and tail", () => {
    expect(shorten("0x5e1a00000000000000000000000000000000c0de")).toBe("0x5e1a…c0de");
  });

  it("leaves short values alone", () => {
    expect(shorten("0x0901", 4, 4)).toBe("0x0901");
  });
});
