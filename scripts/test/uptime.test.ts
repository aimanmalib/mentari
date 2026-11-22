import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../deploy/uptime.sh", import.meta.url));
const run = promisify(execFile);

let server: Server;
let status = 200;
let url = "";
let dir = "";

beforeAll(async () => {
  server = createServer((_req, res) => res.writeHead(status).end("ok"));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "mentari-uptime-"));
  const notify = join(dir, "alert.sh");
  writeFileSync(notify, `#!/usr/bin/env bash\nprintf '%s|%s\\n' "$2" "$1" >> "${join(dir, "sent.log")}"\n`);
  chmodSync(notify, 0o755);
  status = 200;
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function check(): Promise<string[]> {
  await run("bash", [SCRIPT], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      UPTIME_URL: url,
      UPTIME_STATE: join(dir, "state"),
      UPTIME_NOTIFY: join(dir, "alert.sh"),
    },
  });
  const log = join(dir, "sent.log");
  return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}

describe("deploy/uptime.sh", () => {
  it("stays quiet while the site answers 200", async () => {
    expect(await check()).toEqual([]);
    expect(await check()).toEqual([]);
    expect(readFileSync(join(dir, "state"), "utf8")).toBe("up 0\n");
  });

  it("alerts once, only after the second failure in a row", async () => {
    status = 502;
    expect(await check()).toEqual([]);
    const sent = await check();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^warn\|.*failed 2 health checks in a row: \/=502 \/healthz=502/);
    expect(await check()).toHaveLength(1);
  });

  it("forgets a single failure once the site answers again", async () => {
    status = 500;
    await check();
    status = 200;
    await check();
    status = 500;
    expect(await check()).toEqual([]);
  });

  it("sends one recovery line after an alert", async () => {
    status = 503;
    await check();
    await check();
    status = 200;
    const sent = await check();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/^info\|.*is back/);
    expect(await check()).toHaveLength(2);
  });
});
