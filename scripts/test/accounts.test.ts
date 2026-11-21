import { mkdtempSync, readFileSync, rmSync, statSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { accountsPath, createAccountsFile, publicAccounts, readAccountsFile } from "../src/accounts.js";
import { accountIndices, loadAppConfig } from "../src/config.js";

// Public BIP-39 test vector phrase; holds nothing.
const VECTOR = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "mentari-keys-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("accountsPath", () => {
  it("requires an absolute path outside the repository", () => {
    const repo = tmp();
    expect(() => accountsPath({}, repo)).toThrow(/not set/);
    expect(() => accountsPath({ MENTARI_ACCOUNTS: "rel/a.json" }, repo)).toThrow(/absolute/);
    expect(() => accountsPath({ MENTARI_ACCOUNTS: join(repo, "x", "a.json") }, repo)).toThrow(/inside/);
    const outside = join(tmp(), "a.json");
    expect(accountsPath({ MENTARI_ACCOUNTS: outside }, repo)).toBe(outside);
  });
});

describe("createAccountsFile", () => {
  it("writes a 24-word phrase with mode 600 and never overwrites", () => {
    const p = join(tmp(), "nested", "a.json");
    createAccountsFile(p, new Date("2026-11-21T00:00:00Z"));
    expect(statSync(p).mode & 0o777).toBe(0o600);
    const f = readAccountsFile(p);
    expect(f.version).toBe(1);
    expect(f.mnemonic.split(" ")).toHaveLength(24);
    const before = readFileSync(p, "utf8");
    expect(() => createAccountsFile(p)).toThrow();
    expect(readFileSync(p, "utf8")).toBe(before);
  });

  it("refuses a file readable by group or others", () => {
    const p = join(tmp(), "a.json");
    writeFileSync(p, JSON.stringify({ version: 1, createdAt: "", mnemonic: VECTOR }));
    chmodSync(p, 0o644);
    expect(() => readAccountsFile(p)).toThrow(/chmod 600/);
  });
});

describe("publicAccounts", () => {
  it("derives deterministic public addresses and exposes no secret fields", async () => {
    const cfg = loadAppConfig();
    const idx = accountIndices(cfg);
    expect(idx).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 10, 11]);
    const file = { version: 1 as const, createdAt: "", mnemonic: VECTOR };
    const a = await publicAccounts(file, cfg.accounts, [0, 1]);
    const b = await publicAccounts(file, cfg.accounts, [0, 1]);
    expect(a).toEqual(b);
    expect(a[0]?.cosmos).toMatch(/^qor1[02-9ac-hj-np-z]{38}$/);
    expect(a[0]?.evm).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(a[0]?.evm).not.toBe(a[1]?.evm);
    const text = JSON.stringify(a);
    expect(text).not.toContain("abandon");
    expect(Object.keys(a[0] ?? {}).sort()).toEqual(["cosmos", "evm", "index", "role"]);
  });
});
