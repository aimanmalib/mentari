import { describe, expect, it } from "vitest";
import testnet from "../../evidence/testnet.json";
import { verifyNow } from "../src/data/pqCheck.js";
import {
  attestMessage,
  bytes,
  checkReadings,
  decodeReading,
  fetchReadings,
  summarise,
  tamper,
  type ReadingChain,
  type ReadingTx,
  type Verifier,
} from "../src/data/readings.js";
import frozen from "./fixtures/readings.json";

const fixture = frozen as { chainId: number; contract: string; readings: ReadingTx[]; meters: Record<string, string>; keys: Record<string, `0x${string}`> };
const opts = { chainId: fixture.chainId, contract: fixture.contract };
const verifier: Verifier = async (jobs) => verifyNow(jobs);

function chain(over: Partial<ReadingChain> = {}): ReadingChain {
  return {
    meterOf: async (id) => fixture.meters[String(id)] ?? null,
    keyOf: async (a) => fixture.keys[a] ?? null,
    attested: async () => true,
    ...over,
  };
}

describe("decodeReading and attestMessage", () => {
  it("reads system, day, reading and the 4627-byte signature out of the recorded calldata", () => {
    const rs = fixture.readings.map((tx) => decodeReading(tx));
    expect(rs.map((r) => r?.id)).toEqual([2, 1, 3]);
    for (const r of rs) {
      expect(r?.day).toBe(20780);
      expect(r!.wh > 0n).toBe(true);
      expect((r!.sig.length - 2) / 2).toBe(4627);
    }
    expect(decodeReading({ cosmosTx: "X", height: 1, calldata: "0x12345678" })).toBeNull();
  });

  it("rebuilds the 85 bytes Mentari.attestMessage packs: tag, chain id, contract, id, day, reading", () => {
    const m = bytes(attestMessage(9800, fixture.contract, { id: 1, day: 20780, wh: 18982n }));
    expect(m.length).toBe(17 + 32 + 20 + 4 + 4 + 8);
    expect(new TextDecoder().decode(m.slice(0, 17))).toBe("Mentari:attest:v1");
  });
});

describe("checkReadings with real signatures from the testnet", () => {
  it("verifies every recorded reading in the browser and agrees with the chain", async () => {
    const checks = await checkReadings(fixture.readings, chain(), verifier, opts);
    expect(checks.map((c) => c.signature)).toEqual(["valid", "valid", "valid"]);
    expect(summarise(checks)).toEqual({ total: 3, valid: 3, agree: true });
  });

  it("rejects a signature with one byte changed, and then disagrees with the chain", async () => {
    const [first] = fixture.readings;
    const r = decodeReading(first!)!;
    const bad = tamper(r.sig, 100);
    expect(bad.filter((b, i) => b !== bytes(r.sig)[i])).toHaveLength(1);
    const mutant = { ...first!, calldata: first!.calldata.replace(r.sig.slice(2), Buffer.from(bad).toString("hex")) };
    const checks = await checkReadings([mutant], chain(), verifier, opts);
    expect(checks[0]).toMatchObject({ signature: "invalid", chainAccepted: true, agree: false });
    expect(summarise(checks)).toEqual({ total: 1, valid: 0, agree: false });
  });

  it("rejects a valid signature over a different reading (message rebuilt with another contract)", async () => {
    const other = { ...opts, contract: "0x0000000000000000000000000000000000000001" };
    const checks = await checkReadings(fixture.readings.slice(0, 1), chain(), verifier, other);
    expect(checks[0]?.signature).toBe("invalid");
  });

  it("says no-key when the meter has no usable key, and agrees only if the chain did not record it either", async () => {
    const checks = await checkReadings(fixture.readings.slice(0, 1), chain({ keyOf: async () => null }), verifier, opts);
    expect(checks[0]).toMatchObject({ signature: "no-key", agree: false });
    const both = await checkReadings(fixture.readings.slice(0, 1), chain({ keyOf: async () => null, attested: async () => false }), verifier, opts);
    expect(both[0]?.agree).toBe(true);
  });

  it("uses a reading whose transaction is in the recorded evidence (case H step 1)", () => {
    const hashes = JSON.stringify(testnet);
    expect(fixture.readings.some((r) => hashes.includes(r.cosmosTx))).toBe(true);
  });
});

describe("fetchReadings", () => {
  const reply = (status: number, body: unknown) => async () => ({ ok: status === 200, status, json: async () => body });

  it("keeps well-formed rows and throws on a failed or malformed reply", async () => {
    const row = fixture.readings[0]!;
    expect(await fetchReadings(reply(200, { readings: [row, { cosmosTx: 1 }] }), "/api/readings")).toEqual([row]);
    await expect(fetchReadings(reply(502, {}), "/api/readings")).rejects.toThrow(/502/);
    await expect(fetchReadings(reply(200, { readings: null }), "/api/readings")).rejects.toThrow(/unreadable/);
  });
});
