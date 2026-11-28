import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseRange, VideoCopy, type VideoCopyConfig } from "../src/video.js";
import { VIDEO_BYTES } from "./fixture.js";

const dir = mkdtempSync(join(tmpdir(), "mentari-video-"));
writeFileSync(join(dir, "demo.mp4"), VIDEO_BYTES);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const cfg: VideoCopyConfig = { path: "/video/demo.mp4", bytes: VIDEO_BYTES.length, sha256: "cd".repeat(32), cacheSeconds: 600 };

describe("parseRange", () => {
  it("reads open, closed and suffix ranges and clamps the end", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ start: 0, end: 99 });
  });

  it("sends the whole file for shapes it does not serve and refuses ranges past the end", () => {
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=-", 100)).toBeNull();
    expect(parseRange("bytes=9-3", 100)).toBeNull();
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
  });
});

describe("VideoCopy", () => {
  it("matches only its own route", () => {
    const v = new VideoCopy(cfg, dir);
    expect(v.matches("/video/demo.mp4")).toBe(true);
    expect(v.matches("/video/demo.mp4?t=1")).toBe(true);
    expect(v.matches("/video/demo.mp4x")).toBe(false);
    expect(v.matches("/video/other.mp4")).toBe(false);
    expect(new VideoCopy({ ...cfg, path: "" }, dir).matches("")).toBe(false);
  });

  it("answers with cache, etag and range headers from config", async () => {
    const r = await new VideoCopy(cfg, dir).handle("GET", "bytes=10-19");
    expect(r.status).toBe(206);
    expect(r.headers["cache-control"]).toBe("public, max-age=600");
    expect(r.headers.etag).toBe(`"${"cd".repeat(16)}"`);
    expect(r.headers["content-length"]).toBe("10");
  });

  it("serves nothing when the folder is not set, the file is missing or its size is not the configured one", async () => {
    expect((await new VideoCopy(cfg, undefined).handle("GET", undefined)).status).toBe(404);
    expect((await new VideoCopy(cfg, join(dir, "nope")).handle("GET", undefined)).status).toBe(404);
    expect((await new VideoCopy({ ...cfg, bytes: cfg.bytes + 1 }, dir).handle("GET", undefined)).status).toBe(404);
  });
});

describe("committed config", () => {
  it("names one plain .mp4 route with a size and a SHA-256 for the video copy", async () => {
    const { loadServerConfig } = await import("../src/config.js");
    const v = loadServerConfig().videoCopy;
    expect(v.path === "" || /^\/[a-z0-9-]+\/[a-z0-9-]+\.mp4$/.test(v.path)).toBe(true);
    expect(v.bytes).toBeGreaterThan(0);
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
