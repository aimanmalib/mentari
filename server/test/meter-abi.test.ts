import { formatAbiItem } from "viem/utils";
import type { Abi, AbiFunction, AbiParameter } from "viem";
import { describe, expect, it } from "vitest";
import { loadArtifact } from "../../scripts/src/chain.js";
import { mentariMeterAbi } from "../src/meter/abi.js";

type Item = AbiFunction | Extract<Abi[number], { type: "error" }>;
/** Types, with tuples spelled out. Struct field names count: the driver reads `system(id).meter` by name. */
const field = (p: AbiParameter): string => `${norm(p)} ${p.name ?? ""}`;
const norm = (p: AbiParameter): string =>
  "components" in p && p.components ? `(${p.components.map(field).join(",")})${p.type.slice(5)}` : p.type;
const sig = (i: Item) =>
  i.type === "function"
    ? `function ${i.name}(${i.inputs.map(norm).join(",")}) ${i.stateMutability} returns (${i.outputs.map(norm).join(",")})`
    : `error ${i.name}(${i.inputs.map(norm).join(",")})`;

/** The Foundry build output (the gate runs `forge build` before these tests). */
const full = loadArtifact("Mentari").abi.filter((i): i is Item => i.type === "function" || i.type === "error");
const subset = (mentariMeterAbi as Abi).filter((i): i is Item => i.type === "function" || i.type === "error");

describe("the server's Mentari ABI subset", () => {
  it("matches the contract for every function and error it lists", () => {
    const byName = new Map(full.map((i) => [`${i.type} ${i.name}`, i]));
    for (const item of subset) {
      const real = byName.get(`${item.type} ${item.name}`);
      expect(real, `${item.type} ${item.name} is not in the contract`).toBeDefined();
      expect(sig(item)).toBe(sig(real!));
    }
  });

  it("lists every custom error, so a refused call is reported by name", () => {
    const have = new Set(subset.filter((i) => i.type === "error").map((i) => formatAbiItem(i)));
    const want = full.filter((i) => i.type === "error").map((i) => formatAbiItem(i));
    expect(want.filter((e) => !have.has(e))).toEqual([]);
  });
});
