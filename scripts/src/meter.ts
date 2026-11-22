import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ML_DSA_87_SIGNATURE_LENGTH, pqcSign } from "@qorechain/sdk";
import { encodePacked, getAddress, hexToBytes, toHex, type Hex } from "viem";

/**
 * Simulated meters. Nothing here talks to a chain: it turns config/meter.json into daily readings and
 * builds the exact bytes `Mentari.attestMessage` and `Mentari.registerMessage` return, so a signature made
 * here verifies on chain. Readings are generated, not measured from real panels.
 */

export interface MeterSystem {
  id: number;
  label: string;
  capacityW: number;
}

export interface MeterConfig {
  simulated: true;
  /** Constructor argument of Mentari: the chain rejects a day above capacityW * this / 10. */
  maxSunHoursX10: number;
  /** How many finished days before today a backfill run covers. */
  backfillDays: number;
  model: { seed: string; meanSunHours: number; spreadSunHours: number };
  systems: MeterSystem[];
}

const METER_JSON = fileURLToPath(
  new URL("../../config/meter.json", import.meta.url),
);
const UINT32_MAX = 2 ** 32 - 1;
const DAY_MS = 86_400_000;

function isUint(n: unknown, max: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
}

/** Read and check config/meter.json. A model that could exceed the chain's cap is refused here, not on chain. */
export function loadMeterConfig(path: string = METER_JSON): MeterConfig {
  const cfg = JSON.parse(readFileSync(path, "utf8")) as MeterConfig;
  validateMeterConfig(cfg);
  return cfg;
}

export function validateMeterConfig(cfg: MeterConfig): void {
  if (cfg.simulated !== true)
    throw new Error("meter.json: simulated must be true");
  if (!isUint(cfg.maxSunHoursX10, 240) || cfg.maxSunHoursX10 === 0) {
    throw new Error(
      "meter.json: maxSunHoursX10 must be 1..240 (the contract's range)",
    );
  }
  if (!isUint(cfg.backfillDays, 30))
    throw new Error("meter.json: backfillDays must be 0..30");
  const { seed, meanSunHours: mean, spreadSunHours: spread } = cfg.model ?? {};
  if (typeof seed !== "string" || seed.length === 0)
    throw new Error("meter.json: model.seed is empty");
  if (!(spread >= 0) || !(mean - spread > 0))
    throw new Error("meter.json: model must give more than 0 sun hours");
  if (mean + spread > cfg.maxSunHoursX10 / 10) {
    throw new Error(
      "meter.json: meanSunHours + spreadSunHours is above maxSunHoursX10 / 10",
    );
  }
  const ids = new Set<number>();
  for (const s of cfg.systems ?? []) {
    if (!isUint(s.id, UINT32_MAX) || s.id === 0)
      throw new Error(`meter.json: bad system id ${s.id}`);
    if (ids.has(s.id))
      throw new Error(`meter.json: system id ${s.id} appears twice`);
    if (!isUint(s.capacityW, UINT32_MAX) || s.capacityW === 0) {
      throw new Error(`meter.json: system ${s.id} needs capacityW above 0`);
    }
    ids.add(s.id);
  }
  if (ids.size === 0) throw new Error("meter.json: no systems");
}

/** The UTC day number the contract uses: `block.timestamp / 1 days`. */
export function utcDay(at: Date): number {
  return Math.floor(at.getTime() / DAY_MS);
}

/** A number in [0, 1) fixed by (seed, id, day). */
function unit(seed: string, id: number, day: number): number {
  const h = createHash("sha256").update(`${seed}:${id}:${day}`).digest();
  return h.readUIntBE(0, 6) / 2 ** 48;
}

/** The largest reading the contract accepts for this capacity (same integer maths as `Mentari.maxWh`). */
export function maxWh(capacityW: number, maxSunHoursX10: number): number {
  return Math.floor((capacityW * maxSunHoursX10) / 10);
}

/** The simulated reading for one system and one finished UTC day, in whole watt-hours. */
export function simulatedWh(
  cfg: MeterConfig,
  system: MeterSystem,
  day: number,
): number {
  const { seed, meanSunHours, spreadSunHours } = cfg.model;
  const hours =
    meanSunHours + (unit(seed, system.id, day) * 2 - 1) * spreadSunHours;
  const wh = Math.round(system.capacityW * hours);
  return Math.min(Math.max(wh, 1), maxWh(system.capacityW, cfg.maxSunHoursX10));
}

/**
 * Days still to attest for one system, oldest first: finished days in the backfill window that are on or
 * after `firstDay` and not in `attested`. Running it twice after a success returns nothing.
 */
export function daysToAttest(opts: {
  today: number;
  firstDay: number;
  backfillDays: number;
  attested: ReadonlySet<number>;
}): number[] {
  const from = Math.max(opts.firstDay, opts.today - opts.backfillDays);
  const out: number[] = [];
  for (let d = from; d < opts.today; d++)
    if (!opts.attested.has(d)) out.push(d);
  return out;
}

/** Bytes of `Mentari.attestMessage(id, day, wh)` on the given chain and contract. */
export function attestMessage(
  chainId: number,
  contract: string,
  id: number,
  day: number,
  wh: number,
): Uint8Array {
  return packed(
    ["string", "uint256", "address", "uint32", "uint32", "uint64"],
    [
      "Mentari:attest:v1",
      BigInt(chainId),
      getAddress(contract),
      id,
      day,
      BigInt(wh),
    ],
  );
}

/** Bytes of `Mentari.registerMessage(id, meter, producer, capacityW, firstDay)` at registrar nonce `nonce`. */
export function registerMessage(
  chainId: number,
  contract: string,
  nonce: bigint,
  sys: {
    id: number;
    meter: string;
    producer: string;
    capacityW: number;
    firstDay: number;
  },
): Uint8Array {
  return packed(
    [
      "string",
      "uint256",
      "address",
      "uint256",
      "uint32",
      "address",
      "address",
      "uint32",
      "uint32",
    ],
    [
      "Mentari:register:v1",
      BigInt(chainId),
      getAddress(contract),
      nonce,
      sys.id,
      getAddress(sys.meter),
      getAddress(sys.producer),
      sys.capacityW,
      sys.firstDay,
    ],
  );
}

/**
 * ML-DSA-87 signature over `message` as the `sig` argument of `attest` / `registerSystem`. Deterministic
 * signing: the same key and message give the same bytes, so a re-run never produces a second valid reading.
 */
export function signMessage(secretKey: Uint8Array, message: Uint8Array): Hex {
  const sig = pqcSign(secretKey, message);
  if (sig.length !== ML_DSA_87_SIGNATURE_LENGTH)
    throw new Error(`signature is ${sig.length} bytes`);
  return toHex(sig);
}

function packed(
  types: readonly string[],
  values: readonly unknown[],
): Uint8Array {
  return hexToBytes(encodePacked(types as never, values as never) as Hex);
}
