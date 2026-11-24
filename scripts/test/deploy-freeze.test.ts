import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The deploy freeze (decision 0040). Every run uses a COPY of deploy.sh in a temporary folder with no deploy/hos.env,
 * so even a deploy.sh without the freeze stops at "hos.env missing" and can never build or run anything.
 */
const SCRIPT = fileURLToPath(new URL("../../deploy/deploy.sh", import.meta.url));
let dir = "";

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function deploy(freezeAfter: string | null, args: string[], extra: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  dir = mkdtempSync(join(tmpdir(), "mentari-freeze-"));
  mkdirSync(join(dir, "deploy"));
  mkdirSync(join(dir, "config"));
  copyFileSync(SCRIPT, join(dir, "deploy", "deploy.sh"));
  writeFileSync(join(dir, "config", "limits.json"), JSON.stringify(freezeAfter === null ? {} : { deploy: { freezeAfter } }));
  return new Promise((resolve) => {
    execFile("bash", [join(dir, "deploy", "deploy.sh"), ...args], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...extra } }, (err, stdout) =>
      resolve({ code: err ? Number(err.code) : 0, out: stdout }),
    );
  });
}

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2999-01-01T00:00:00Z";

describe("deploy/deploy.sh freeze", () => {
  it("refuses a deploy after freezeAfter without MENTARI_JURI_MINTA, before reading any host file", async () => {
    const r = await deploy(PAST, []);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/deploys are frozen since 2020-01-01T00:00:00Z/);
    expect(r.out).not.toMatch(/hos\.env/);
  });

  it("lets a deploy through after freezeAfter when the judges asked for a change", async () => {
    const r = await deploy(PAST, ["--check-freeze"], { MENTARI_JURI_MINTA: "judges asked to fix the verify page" });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/lifted for: judges asked to fix the verify page/);
  });

  it("allows a deploy before freezeAfter", async () => {
    expect((await deploy(FUTURE, ["--check-freeze"])).code).toBe(0);
    expect((await deploy(PAST, ["--check-freeze"])).code).toBe(1);
  });

  it("refuses when freezeAfter is missing or not a date", async () => {
    const r = await deploy(null, []);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/cannot read deploy\.freezeAfter/);
  });

  it("keeps --rollback open after the freeze", async () => {
    const r = await deploy(PAST, ["--rollback"]);
    expect(r.out).not.toMatch(/frozen/);
    expect(r.out).toMatch(/hos\.env missing/);
  });
});

describe("config/limits.json blocks the deploy scripts read", () => {
  const limits = JSON.parse(readFileSync(fileURLToPath(new URL("../../config/limits.json", import.meta.url)), "utf8"));
  it("has a parseable deploy.freezeAfter and numeric selftest and funds values", () => {
    expect(Number.isFinite(Date.parse(limits.deploy.freezeAfter))).toBe(true);
    for (const k of ["failsBeforeAlert", "statusTries", "statusRetrySeconds", "balanceToleranceQor", "timeoutSeconds", "verifyTimeoutSeconds"])
      expect(typeof limits.selftest[k]).toBe("number");
    expect(typeof limits.funds.warnQor).toBe("number");
    expect(typeof limits.funds.role).toBe("string");
  });
});
