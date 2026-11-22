import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogues, pickLocale, translate } from "../src/i18n/core.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

function flatten(node: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === "object" && v !== null) Object.assign(out, flatten(v, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = String(v);
  }
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const en = flatten(catalogues.en);
const ms = flatten(catalogues.ms);
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("locale files", () => {
  it("have the same keys", () => {
    expect(Object.keys(ms).sort()).toEqual(Object.keys(en).sort());
  });

  it("have no empty values and no long dashes", () => {
    for (const value of [...Object.values(en), ...Object.values(ms)]) {
      expect(value.trim()).not.toBe("");
      expect(value).not.toContain("—");
    }
  });

  it("use the same placeholders in both languages", () => {
    for (const key of Object.keys(en)) expect(placeholders(ms[key]!), key).toEqual(placeholders(en[key]!));
  });

  it("contain every literal key the source code asks for", () => {
    const used = new Set<string>();
    for (const file of sources(SRC)) {
      for (const m of readFileSync(file, "utf8").matchAll(/\bt\("([\w.-]+)"/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) expect(en, key).toHaveProperty([key]);
  });
});

describe("translate", () => {
  it("fills placeholders", () => {
    expect(translate(catalogues.en!, "unit.wh", { value: "1,500" })).toBe("1,500 Wh");
  });

  it("shows the key when a message is missing, so gaps are visible", () => {
    expect(translate(catalogues.en!, "nope.missing")).toBe("nope.missing");
    expect(translate(catalogues.en!, "registry")).toBe("registry");
  });

  it("leaves unknown placeholders in place", () => {
    expect(translate(catalogues.en!, "unit.wh")).toBe("{value} Wh");
  });
});

describe("pickLocale", () => {
  const langs = ["en", "ms"];
  it("prefers the URL, then the saved choice, then the browser", () => {
    expect(pickLocale(langs, "en", { query: "ms", saved: "en", browser: ["en-GB"] })).toBe("ms");
    expect(pickLocale(langs, "en", { query: null, saved: "ms", browser: ["en-GB"] })).toBe("ms");
    expect(pickLocale(langs, "en", { browser: ["fr-FR", "ms-MY"] })).toBe("ms");
  });

  it("ignores unknown values and falls back to the default", () => {
    expect(pickLocale(langs, "en", { query: "xx", saved: "de", browser: ["fr"] })).toBe("en");
  });
});
