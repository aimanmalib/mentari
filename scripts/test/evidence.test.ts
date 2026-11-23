import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { accountsEvidence, writeEvidence } from "../src/evidence.js";
import type { StatusRow } from "../src/native.js";

const row = (over: Partial<StatusRow> = {}): StatusRow => ({
  role: "registrar",
  cosmos: "qor1example",
  balance: 6_000_000n,
  registered: true,
  possessionProven: true,
  windowLive: false,
  low: false,
  ...over,
});
const META = {
  chainId: "test-chain",
  rest: "https://rest.example",
  readAt: new Date("2026-11-23T10:00:00Z"),
};

describe("accountsEvidence", () => {
  it("records public state with the balance as a decimal string", () => {
    const out = accountsEvidence([row()], { registrar: "0xAbC" }, META);
    expect(out).toEqual({
      chainId: "test-chain",
      rest: "https://rest.example",
      readAt: "2026-11-23T10:00:00.000Z",
      accounts: [
        {
          role: "registrar",
          evm: "0xAbC",
          cosmos: "qor1example",
          balanceUqor: "6000000",
          pqcKeyRegistered: true,
          possessionProven: true,
          evmWindowOpen: false,
        },
      ],
    });
  });

  it("writes null when the node does not report the proof of possession", () => {
    const out = accountsEvidence(
      [row({ possessionProven: undefined })],
      { registrar: "0x1" },
      META,
    );
    expect(out.accounts[0]!.possessionProven).toBeNull();
  });

  it("refuses a role with no EVM address", () => {
    expect(() =>
      accountsEvidence([row({ role: "buyer" })], { registrar: "0x1" }, META),
    ).toThrow(/buyer/);
  });
});

describe("writeEvidence", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates the folder and ends the file with a newline", () => {
    dir = mkdtempSync(join(tmpdir(), "mentari-evidence-"));
    const path = join(dir, "evidence", "x.json");
    writeEvidence(path, { a: 1 });
    expect(readFileSync(path, "utf8")).toBe('{\n  "a": 1\n}\n');
  });
});
