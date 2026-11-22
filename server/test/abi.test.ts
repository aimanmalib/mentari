import { formatAbiItem } from "viem/utils";
import type { Abi, AbiFunction, AbiParameter } from "viem";
import { describe, expect, it } from "vitest";
import { loadArtifact } from "../../scripts/src/chain.js";
import { mentariDemoAbi, mentariMeterAbi, probeDemoAbi } from "../src/abi.js";

type Item = AbiFunction | Extract<Abi[number], { type: "error" }>;
/** Types, with tuples spelled out. Struct field names count: the driver reads `system(id).meter` by name. */
const field = (p: AbiParameter): string => `${norm(p)} ${p.name ?? ""}`;
const norm = (p: AbiParameter): string =>
  "components" in p && p.components ? `(${p.components.map(field).join(",")})${p.type.slice(5)}` : p.type;
const sig = (i: Item) =>
  i.type === "function"
    ? `function ${i.name}(${i.inputs.map(norm).join(",")}) ${i.stateMutability} returns (${i.outputs.map(norm).join(",")})`
    : `error ${i.name}(${i.inputs.map(norm).join(",")})`;

const items = (abi: Abi) => abi.filter((i): i is Item => i.type === "function" || i.type === "error");

/** Each subset with the contract it is cut from, in the Foundry build output (the gate runs `forge build` first). */
const SUBSETS: [string, string, Abi][] = [
  ["meter run", "Mentari", mentariMeterAbi as Abi],
  ["demo sender", "Mentari", mentariDemoAbi as Abi],
  ["demo sender", "AtomicityProbe", probeDemoAbi as Abi],
];

describe.each(SUBSETS)("the %s ABI subset of %s", (_who, contract, abi) => {
  const full = items(loadArtifact(contract).abi);
  const subset = items(abi);

  it("matches the contract for every function and error it lists", () => {
    const byName = new Map(full.map((i) => [`${i.type} ${i.name}`, i]));
    for (const item of subset) {
      const real = byName.get(`${item.type} ${item.name}`);
      expect(real, `${item.type} ${item.name} is not in ${contract}`).toBeDefined();
      expect(sig(item)).toBe(sig(real!));
    }
  });

  it("lists every custom error, so a refused call is reported by name", () => {
    const have = new Set(subset.filter((i) => i.type === "error").map((i) => formatAbiItem(i)));
    const want = full.filter((i) => i.type === "error").map((i) => formatAbiItem(i));
    expect(want.filter((e) => !have.has(e))).toEqual([]);
  });
});
