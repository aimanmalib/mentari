import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../deploy/funds.sh", import.meta.url));
const run = promisify(execFile);

/** Frozen config and accounts, so a change to config/app.json or evidence/ never turns these tests red. */
const CONFIG = {
  network: { rest: "http://unused" },
  nativeLane: { denom: "uqor", decimals: 6 },
  funding: { lowBalanceQor: "8", lowBalanceRoles: ["funder", "sender"] },
};
const ACCOUNTS = {
  accounts: [
    { role: "funder", cosmos: "qor1funder" },
    { role: "sender", cosmos: "qor1sender" },
    { role: "other", cosmos: "qor1other" },
  ],
};

let server: Server;
let rest = "";
let dir = "";
let balances: Record<string, string | null> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    const addr = /balances\/([^/]+)\/by_denom/.exec(req.url ?? "")?.[1] ?? "";
    const amount = balances[addr];
    if (amount === null || amount === undefined)
      return res.writeHead(502).end("down");
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ balance: { denom: "uqor", amount } }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  rest = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "mentari-funds-"));
  writeFileSync(join(dir, "app.json"), JSON.stringify(CONFIG));
  writeFileSync(join(dir, "accounts.json"), JSON.stringify(ACCOUNTS));
  const notify = join(dir, "alert.sh");
  writeFileSync(
    notify,
    `#!/usr/bin/env bash\nprintf '%s|%s\\n' "$2" "$1" >> "${join(dir, "sent.log")}"\n`,
  );
  chmodSync(notify, 0o755);
  balances = { qor1funder: "70000000", qor1sender: "15000000", qor1other: "0" };
});

async function check(): Promise<string[]> {
  await run("bash", [SCRIPT], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      FUNDS_CONFIG: join(dir, "app.json"),
      FUNDS_ACCOUNTS: join(dir, "accounts.json"),
      FUNDS_REST: rest,
      FUNDS_STATE: join(dir, "state"),
      FUNDS_NOTIFY: join(dir, "alert.sh"),
    },
  });
  const log = join(dir, "sent.log");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

describe("deploy/funds.sh", () => {
  it("sends nothing while every watched account is above the line, and ignores unwatched roles", async () => {
    expect(await check()).toEqual([]);
    expect(readFileSync(join(dir, "state"), "utf8")).toBe("ok\n");
  });

  it("warns once when a watched account drops below the line, then stays quiet", async () => {
    balances.qor1sender = "7999999";
    const sent = await check();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^warn\|.*sender \(qor1sender\) has 7\.99 QOR;/);
    expect(sent[0]).not.toMatch(/funder \(/);
    expect(await check()).toHaveLength(1);
  });

  it("treats exactly the line as enough", async () => {
    balances.qor1funder = "8000000";
    expect(await check()).toEqual([]);
  });

  it("sends one info line when the funds come back", async () => {
    balances.qor1funder = "1";
    await check();
    balances.qor1funder = "20000000";
    const sent = await check();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/^info\|/);
  });

  it("changes nothing when the REST endpoint fails", async () => {
    balances.qor1funder = "1";
    await check();
    balances.qor1funder = null;
    expect(await check()).toHaveLength(1);
    expect(readFileSync(join(dir, "state"), "utf8")).toBe("low\n");
  });
});
