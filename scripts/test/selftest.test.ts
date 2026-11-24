import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../deploy/selftest.sh", import.meta.url));

/** Frozen config, accounts and status, so a change to config/ or evidence/ never turns these tests red. */
const APP = {
  network: { rest: "http://unused", evmRpc: "http://unused" },
  nativeLane: { denom: "uqor", decimals: 6 },
  funding: { funder: "funder" },
};
const LIMITS = {
  demo: { enabled: true, minSenderBalanceQor: 8 },
  funds: { role: "sender", warnQor: 20 },
  selftest: { failsBeforeAlert: 2, statusTries: 2, statusRetrySeconds: 0, balanceToleranceQor: 1, timeoutSeconds: 5, verifyTimeoutSeconds: 30 },
};
const ACCOUNTS = { accounts: [{ role: "funder", cosmos: "qor1funder" }, { role: "sender", cosmos: "qor1sender" }] };
const job = (lane = "native") => ({ ready: true, lane, reason: null });
const goodStatus = () => ({
  enabled: true, ready: true, busy: false,
  retire: job(), cases: job(), grant: job(),
  senderBalanceQor: 47.3, evmWindow: null as null | { live: boolean; untilBlock: number },
});

let server: Server;
let base = "";
let dir = "";
let balances: Record<string, string | null>;
let status: ReturnType<typeof goodStatus> | null;
let block = 100;
let verifyCmd = "echo '98 of 98 checks passed, 0 failed.'";

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = req.url ?? "";
    if (req.method === "POST") {
      return res.writeHead(200).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: `0x${block.toString(16)}` }));
    }
    if (u === "/api/demo/status") return status ? res.writeHead(200).end(JSON.stringify(status)) : res.writeHead(503).end();
    const amount = balances[/balances\/([^/]+)\/by_denom/.exec(u)?.[1] ?? ""];
    if (amount == null) return res.writeHead(502).end("down");
    res.writeHead(200).end(JSON.stringify({ balance: { denom: "uqor", amount } }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "mentari-selftest-"));
  for (const [f, v] of Object.entries({ "app.json": APP, "limits.json": LIMITS, "accounts.json": ACCOUNTS }))
    writeFileSync(join(dir, f), JSON.stringify(v));
  const notify = join(dir, "alert.sh");
  writeFileSync(notify, `#!/usr/bin/env bash\nprintf '%s|%s\\n' "$2" "$1" >> "${join(dir, "sent.log")}"\n`);
  chmodSync(notify, 0o755);
  balances = { qor1funder: "21500000", qor1sender: "47300000" };
  status = goodStatus();
  block = 100;
  verifyCmd = "echo '98 of 98 checks passed, 0 failed.'";
});

/** One run: exit code, printed lines and every alert sent so far. */
function check(node = process.execPath): Promise<{ code: number; out: string; sent: string[] }> {
  return new Promise((resolve) => {
    execFile("bash", [SCRIPT], {
      env: {
        PATH: "/usr/bin:/bin",
        HOME: dir,
        SELFTEST_NODE: node,
        SELFTEST_URL: base,
        SELFTEST_REST: base,
        SELFTEST_EVM: base,
        SELFTEST_APP: join(dir, "app.json"),
        SELFTEST_LIMITS: join(dir, "limits.json"),
        SELFTEST_ACCOUNTS: join(dir, "accounts.json"),
        SELFTEST_STATE: join(dir, "state"),
        SELFTEST_NOTIFY: join(dir, "alert.sh"),
        SELFTEST_VERIFY_CMD: verifyCmd,
      },
    }, (err, stdout) => {
      const log = join(dir, "sent.log");
      const sent = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
      resolve({ code: err ? Number(err.code) : 0, out: stdout, sent });
    });
  });
}

describe("deploy/selftest.sh", () => {
  it("passes quietly when the status is honest, the funds are above the line and verify passes", async () => {
    const r = await check();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ok sender qor1sender holds 47\.30 QOR$/m);
    expect(r.out).toMatch(/^ok verify: 98 of 98 checks passed/m);
    expect(r.out).not.toMatch(/^FAIL/m);
    expect(r.sent).toEqual([]);
    expect(readFileSync(join(dir, "state"), "utf8")).toBe("up 0 ok\n");
  });

  it("warns once at the first run when the demo sender drops below funds.warnQor, then once when it is back", async () => {
    balances.qor1sender = "19990000";
    status!.senderBalanceQor = 19.99;
    const first = await check();
    expect(first.out).toMatch(/^LOW sender qor1sender holds 19\.99 QOR, below 20 QOR$/m);
    expect(first.sent).toHaveLength(1);
    expect(first.sent[0]).toMatch(/^warn\|Mentari demo sender is low .*19\.99 QOR/);
    expect((await check()).sent).toHaveLength(1);
    balances.qor1sender = "20000000";
    status!.senderBalanceQor = 20;
    const back = await check();
    expect(back.sent).toHaveLength(2);
    expect(back.sent[1]).toMatch(/^info\|Mentari demo sender is back/);
    expect(back.code).toBe(0);
  });

  it("calls a status dishonest when a button says ready on an EVM window that already ended, and alerts on the second run", async () => {
    status!.cases = job("evm-window");
    status!.evmWindow = { live: true, untilBlock: 90 };
    const first = await check();
    expect(first.code).toBe(1);
    expect(first.out).toMatch(/^FAIL \/api\/demo\/status: cases say ready on the EVM window, but it ended \(block 100, window until 90\)/m);
    expect(first.sent).toEqual([]);
    const second = await check();
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0]).toMatch(/^warn\|Mentari demo self-test failed 2 runs in a row/);
    expect((await check()).sent).toHaveLength(1);
  });

  it("accepts a ready EVM window that is still open", async () => {
    status!.cases = job("evm-window");
    status!.evmWindow = { live: true, untilBlock: 150 };
    expect((await check()).code).toBe(0);
  });

  it("flags a status balance that does not match the chain, and ready while the sender is below the demo minimum", async () => {
    balances.qor1sender = "5000000";
    const r = await check();
    expect(r.out).toMatch(/retire says ready while the sender holds 5\.00 QOR/);
    expect(r.out).toMatch(/senderBalanceQor 47\.3 differs from the chain's 5\.00/);
  });

  it("flags a status that is ready with a reason, or not ready without one, or Retire now not ready", async () => {
    status!.grant = { ready: true, lane: "native", reason: "low-funds" } as never;
    status!.retire = { ready: false, lane: "native", reason: null } as never;
    const r = await check();
    expect(r.out).toMatch(/grant says ready but has reason low-funds/);
    expect(r.out).toMatch(/retire is not ready and names no reason/);
    expect(r.out).toMatch(/Retire now is not ready/);
  });

  it("counts an unreachable status and a failed verify as failures, and sends one info line on recovery", async () => {
    status = null;
    verifyCmd = "echo '97 of 98 checks passed, 1 failed.'; exit 1";
    const first = await check();
    expect(first.out).toMatch(/^FAIL \/api\/demo\/status: status could not be read \(HTTP 503\)/m);
    expect(first.out).toMatch(/^FAIL verify exited 1: 97 of 98 checks passed, 1 failed\./m);
    await check();
    status = goodStatus();
    verifyCmd = "echo '98 of 98 checks passed, 0 failed.'";
    const back = await check();
    expect(back.sent.map((s) => s.split("|")[0])).toEqual(["warn", "info"]);
    expect(readFileSync(join(dir, "state"), "utf8")).toBe("up 0 ok\n");
  });

  it("refuses a node older than 22 (cron's /usr/bin/node) instead of running the checks", async () => {
    const old = join(dir, "node18");
    writeFileSync(old, "#!/usr/bin/env bash\necho 18\n");
    chmodSync(old, 0o755);
    const r = await check(old);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^FAIL node at '.*node18' is version 18, the scripts need 22 or newer/m);
  });
});
