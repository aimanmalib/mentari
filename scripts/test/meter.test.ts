import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePqcKeypair, pqcVerify } from "@qorechain/sdk";
import { hexToBytes, keccak256, toHex } from "viem";
import { afterAll, describe, expect, it } from "vitest";
import {
  attestMessage,
  daysToAttest,
  loadMeterConfig,
  maxWh,
  registerMessage,
  signMessage,
  simulatedWh,
  utcDay,
  validateMeterConfig,
  type MeterConfig,
} from "../src/meter.js";

/** Frozen fixture, so a change to config/meter.json never turns these tests red. */
const CFG: MeterConfig = {
  simulated: true,
  maxSunHoursX10: 80,
  backfillDays: 3,
  model: { seed: "fixture-seed", meanSunHours: 4.6, spreadSunHours: 1.2 },
  systems: [
    { id: 1, label: "A", capacityW: 5000 },
    { id: 2, label: "B", capacityW: 8200 },
  ],
};

const tmp = mkdtempSync(join(tmpdir(), "mentari-meter-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function withConfig(patch: (c: MeterConfig) => void): MeterConfig {
  const c = structuredClone(CFG);
  patch(c);
  return c;
}

describe("meter config", () => {
  it("loads the shipped config/meter.json", () => {
    const cfg = loadMeterConfig();
    expect(cfg.systems.length).toBeGreaterThan(0);
    for (const s of cfg.systems) expect(s.capacityW).toBeGreaterThan(0);
  });

  it("refuses a model that could go over the chain's cap", () => {
    expect(() =>
      validateMeterConfig(withConfig((c) => (c.model.meanSunHours = 7.5))),
    ).toThrow(/above maxSunHoursX10/);
  });

  it("refuses bad systems and non-simulated meters", () => {
    expect(() =>
      validateMeterConfig(withConfig((c) => (c.systems[1]!.id = 1))),
    ).toThrow(/twice/);
    expect(() =>
      validateMeterConfig(withConfig((c) => (c.systems[0]!.capacityW = 0))),
    ).toThrow(/capacityW/);
    expect(() =>
      validateMeterConfig(withConfig((c) => (c.systems = []))),
    ).toThrow(/no systems/);
    expect(() =>
      validateMeterConfig(
        withConfig((c) => ((c as { simulated: boolean }).simulated = false)),
      ),
    ).toThrow(/simulated/);
    expect(() =>
      validateMeterConfig(withConfig((c) => (c.maxSunHoursX10 = 241))),
    ).toThrow(/1\.\.240/);
  });

  it("reads a file from any path", () => {
    const p = join(tmp, "meter.json");
    writeFileSync(p, JSON.stringify(CFG));
    expect(loadMeterConfig(p).model.seed).toBe("fixture-seed");
  });
});

describe("simulatedWh", () => {
  const [a, b] = CFG.systems as [
    MeterConfig["systems"][0],
    MeterConfig["systems"][0],
  ];

  it("is the same for the same system and day", () => {
    expect(simulatedWh(CFG, a, 20_400)).toBe(simulatedWh(CFG, a, 20_400));
  });

  it("changes with the day, the system and the seed", () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      simulatedWh(CFG, a, 20_400 + i),
    );
    expect(new Set(days).size).toBeGreaterThan(20);
    expect(simulatedWh(CFG, a, 20_400) / a.capacityW).not.toBe(
      simulatedWh(CFG, b, 20_400) / b.capacityW,
    );
    const other = withConfig((c) => (c.model.seed = "other"));
    expect(simulatedWh(other, a, 20_400)).not.toBe(simulatedWh(CFG, a, 20_400));
  });

  it("stays inside the model's band and the chain's cap over a year", () => {
    for (const s of CFG.systems) {
      for (let d = 20_000; d < 20_365; d++) {
        const wh = simulatedWh(CFG, s, d);
        expect(wh).toBeGreaterThanOrEqual(Math.floor(s.capacityW * 3.4));
        expect(wh).toBeLessThanOrEqual(Math.ceil(s.capacityW * 5.8));
        expect(wh).toBeLessThanOrEqual(maxWh(s.capacityW, CFG.maxSunHoursX10));
      }
    }
  });

  it("never returns 0 or more than the chain accepts, even from an unchecked config", () => {
    const high = withConfig(
      (c) => (c.model = { seed: "x", meanSunHours: 30, spreadSunHours: 0 }),
    );
    expect(simulatedWh(high, a, 20_400)).toBe(
      maxWh(a.capacityW, high.maxSunHoursX10),
    );
    const low = withConfig(
      (c) => (c.model = { seed: "x", meanSunHours: 0.0001, spreadSunHours: 0 }),
    );
    expect(simulatedWh(low, { id: 9, label: "Z", capacityW: 1 }, 20_400)).toBe(
      1,
    );
  });

  it("uses the contract's integer maths for the cap", () => {
    expect(maxWh(5000, 80)).toBe(40_000);
    expect(maxWh(1001, 75)).toBe(7507);
  });
});

describe("daysToAttest", () => {
  it("covers the finished days of the backfill window, oldest first", () => {
    expect(
      daysToAttest({
        today: 100,
        firstDay: 0,
        backfillDays: 3,
        attested: new Set(),
      }),
    ).toEqual([97, 98, 99]);
  });

  it("skips attested days and days before the system existed", () => {
    expect(
      daysToAttest({
        today: 100,
        firstDay: 98,
        backfillDays: 3,
        attested: new Set([99]),
      }),
    ).toEqual([98]);
  });

  it("returns nothing on a second run after every day was attested", () => {
    const first = daysToAttest({
      today: 100,
      firstDay: 0,
      backfillDays: 3,
      attested: new Set(),
    });
    expect(
      daysToAttest({
        today: 100,
        firstDay: 0,
        backfillDays: 3,
        attested: new Set(first),
      }),
    ).toEqual([]);
  });

  it("with a window of one day, is yesterday only (the daily run)", () => {
    expect(
      daysToAttest({
        today: 100,
        firstDay: 0,
        backfillDays: 1,
        attested: new Set(),
      }),
    ).toEqual([99]);
  });

  it("counts UTC days the way the contract does", () => {
    expect(utcDay(new Date("1970-01-02T00:00:00Z"))).toBe(1);
    expect(utcDay(new Date("2026-11-22T23:59:59Z"))).toBe(
      utcDay(new Date("2026-11-22T00:00:00Z")),
    );
  });
});

describe("signed messages", () => {
  // The same vectors are pinned on the contract side in contracts/test/mentari/MentariMessages.t.sol.
  const AT = "0x00000000000000000000000000000000004D3E17";

  it("encodes attestMessage exactly as the contract does", () => {
    expect(keccak256(toHex(attestMessage(9800, AT, 2, 20_400, 23_456)))).toBe(
      "0x19bcb0e56e049e7743abf17a6c888b3a3dcfa5b00d4af8ce61a7f9b1fbe2e00f",
    );
  });

  it("encodes registerMessage exactly as the contract does", () => {
    const sys = {
      id: 2,
      meter: "0x00000000000000000000000000000000000000a2",
      producer: "0x00000000000000000000000000000000000000b5",
      capacityW: 8200,
      firstDay: 20_397,
    };
    expect(keccak256(toHex(registerMessage(9800, AT, 0n, sys)))).toBe(
      "0xd8b8d051cfe18276cd6c9f97f4f0b52df8562d86bcee807d0e0d278a47b89abc",
    );
    expect(keccak256(toHex(registerMessage(9800, AT, 1n, sys)))).not.toBe(
      "0xd8b8d051cfe18276cd6c9f97f4f0b52df8562d86bcee807d0e0d278a47b89abc",
    );
  });

  it("binds the chain and the contract", () => {
    const base = toHex(attestMessage(9800, AT, 2, 20_400, 23_456));
    expect(toHex(attestMessage(1, AT, 2, 20_400, 23_456))).not.toBe(base);
    expect(
      toHex(
        attestMessage(
          9800,
          "0x00000000000000000000000000000000004D3E18",
          2,
          20_400,
          23_456,
        ),
      ),
    ).not.toBe(base);
  });

  it("signs with ML-DSA-87 so the reading verifies, deterministically", () => {
    const kp = generatePqcKeypair(new Uint8Array(32).fill(7));
    const msg = attestMessage(
      9800,
      AT,
      1,
      20_400,
      simulatedWh(CFG, CFG.systems[0]!, 20_400),
    );
    const sig = signMessage(kp.secretKey, msg);
    expect(hexToBytes(sig).length).toBe(4627);
    expect(pqcVerify(kp.publicKey, msg, hexToBytes(sig))).toBe(true);
    expect(signMessage(kp.secretKey, msg)).toBe(sig);
    expect(
      pqcVerify(
        kp.publicKey,
        attestMessage(9800, AT, 1, 20_400, 1),
        hexToBytes(sig),
      ),
    ).toBe(false);
  });
});
