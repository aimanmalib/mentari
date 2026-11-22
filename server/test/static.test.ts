import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { StaticSite } from "../src/static.js";

const empty = mkdtempSync(join(tmpdir(), "mentari-empty-"));
afterAll(() => rmSync(empty, { recursive: true, force: true }));

describe("StaticSite without a build", () => {
  it("says the site is not built instead of crashing", async () => {
    const r = await new StaticSite(empty).handle("GET", "/");
    expect(r.status).toBe(503);
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("refuses bad escapes and NUL bytes", async () => {
    const site = new StaticSite(empty);
    expect((await site.handle("GET", "/%E0%A4%A")).status).toBe(404);
    expect((await site.handle("GET", "/a%00.txt")).status).toBe(404);
  });
});
