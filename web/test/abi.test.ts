import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mentariReadAbi } from "../src/data/abi.js";

const SOL = readFileSync(new URL("../../contracts/src/Mentari.sol", import.meta.url), "utf8");

/** Field names and types of a struct in Mentari.sol, in order. */
function structFields(name: string): [string, string][] {
  const body = SOL.match(new RegExp(`struct ${name} \\{([^}]*)\\}`))?.[1] ?? "";
  return [...body.matchAll(/(\w+)\s+(\w+);/g)].map((m) => [m[2]!, m[1]!]);
}

describe("the site's ABI matches contracts/src/Mentari.sol", () => {
  it.each(mentariReadAbi.map((f) => [f.name, f] as const))("%s has the same inputs", (name, fn) => {
    const sig = SOL.match(new RegExp(`function ${name}\\(([^)]*)\\)[^{;]*\\bview\\b`))?.[1];
    expect(sig, `view function ${name} not found`).toBeDefined();
    const types = sig!.split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean);
    expect(types).toEqual(fn.inputs.map((i) => i.type));
  });

  it.each([
    ["retirement", "Retirement"],
    ["system", "System"],
  ] as const)("%s returns the %s struct field by field", (fnName, struct) => {
    const fn = mentariReadAbi.find((f) => f.name === fnName)!;
    const out = fn.outputs[0] as { components: readonly { name: string; type: string }[] };
    expect(out.components.map((c) => [c.name, c.type])).toEqual(structFields(struct));
  });
});
