import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHandler } from "../src/app.js";
import { DemoApi } from "../src/demo/api.js";
import { ExplorerLinks } from "../src/explorer.js";
import { LcdProxy } from "../src/lcd.js";
import { Readings } from "../src/readings.js";
import { StaticSite } from "../src/static.js";
import { VideoCopy } from "../src/video.js";
import { fakeFetch, FakeChain, ORIGIN, testConfig, VIDEO_BYTES } from "./fixture.js";

let dir: string;
let server: Server;
let base: string;
const upstream = fakeFetch();

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mentari-server-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>t</title>");
  writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(dir, "robots.txt"), "User-agent: *");
  mkdirSync(join(dir, "film"));
  writeFileSync(join(dir, "film", "demo.mp4"), VIDEO_BYTES);
  writeFileSync(join(tmpdir(), "mentari-outside.txt"), "secret");
  const cfg = testConfig();
  const demo = new DemoApi(cfg.demo, new FakeChain());
  const lcd = new LcdProxy(cfg, upstream.fn);
  const explorer = new ExplorerLinks({ ...cfg.explorer, restOrigin: cfg.restOrigin }, lcd);
  const readings = new Readings({ ...cfg.readings, restOrigin: cfg.restOrigin }, lcd);
  server = createServer(createHandler({ cfg, lcd, explorer, demo, readings, site: new StaticSite(dir), video: new VideoCopy(cfg.videoCopy, join(dir, "film")) }));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  rmSync(dir, { recursive: true, force: true });
  rmSync(join(tmpdir(), "mentari-outside.txt"), { force: true });
});

describe("server", () => {
  it("answers /healthz", async () => {
    const r = await fetch(`${base}/healthz`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect((await fetch(`${base}/healthz`, { method: "POST" })).status).toBe(405);
  });

  it("serves HTML with no-transform and security headers", async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sends /go/tx/<hash> to the explorer instead of the page shell", async () => {
    const hash = "ab".repeat(32);
    const r = await fetch(`${base}/go/tx/${hash}`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`https://explorer.example.test/tx/${hash.toUpperCase()}`);
  });

  it("routes /go/receipt/<id> to the receipt lookup, not the page shell", async () => {
    const r = await fetch(`${base}/go/receipt/x`, { redirect: "manual" });
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).not.toMatch(/^text\/html/);
  });

  it("falls back to index.html for client routes but not for missing files", async () => {
    const route = await fetch(`${base}/verify`);
    expect(route.status).toBe(200);
    expect(route.headers.get("cache-control")).toContain("no-transform");
    expect((await fetch(`${base}/missing.png`)).status).toBe(404);
  });

  it("caches hashed assets for a year and other files briefly", async () => {
    expect((await fetch(`${base}/assets/app-abc123.js`)).headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${base}/robots.txt`)).headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("never serves files outside the site folder", async () => {
    for (const p of ["/../mentari-outside.txt", "/%2e%2e/mentari-outside.txt", "/assets/..%2f..%2fmentari-outside.txt"]) {
      const r = await fetch(`${base}${p}`);
      expect(await r.text()).not.toContain("secret");
    }
  });

  it("answers HEAD without a body and other methods with 405", async () => {
    const head = await fetch(`${base}/`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await fetch(`${base}/`, { method: "DELETE" })).status).toBe(405);
  });

  it("serves the video copy whole, as a byte range, and 416 past the end, through the real socket", async () => {
    const whole = await fetch(`${base}/video/demo.mp4`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-length")).toBe(String(VIDEO_BYTES.length));
    expect(Buffer.from(await whole.arrayBuffer()).equals(VIDEO_BYTES)).toBe(true);

    const part = await fetch(`${base}/video/demo.mp4`, { headers: { range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 0-99/${VIDEO_BYTES.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(VIDEO_BYTES.subarray(0, 100))).toBe(true);

    const tail = await fetch(`${base}/video/demo.mp4`, { headers: { range: "bytes=-10" } });
    expect(Buffer.from(await tail.arrayBuffer()).equals(VIDEO_BYTES.subarray(990))).toBe(true);

    const past = await fetch(`${base}/video/demo.mp4`, { headers: { range: "bytes=5000-" } });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe(`bytes */${VIDEO_BYTES.length}`);

    const head = await fetch(`${base}/video/demo.mp4`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(VIDEO_BYTES.length));
    expect((await fetch(`${base}/video/demo.mp4`, { method: "POST" })).status).toBe(405);
  });

  it("routes /lcd to the proxy: allowed path proxied, others 404, other methods 405", async () => {
    const ok = await fetch(`${base}/lcd/qorechain/crossvm/v1/params`);
    expect(ok.status).toBe(200);
    expect(upstream.calls.at(-1)).toBe(`${ORIGIN}/qorechain/crossvm/v1/params`);
    const before = upstream.calls.length;
    expect((await fetch(`${base}/lcd/cosmos/bank/v1beta1/supply`)).status).toBe(404);
    expect((await fetch(`${base}/lcd/qorechain/crossvm/v1/params`, { method: "POST" })).status).toBe(405);
    expect(upstream.calls.length).toBe(before);
  });

  it("does not treat /lcdx as the proxy and keeps /api closed", async () => {
    expect((await fetch(`${base}/lcdx`)).headers.get("content-type")).toMatch(/^text\/html/);
    expect((await fetch(`${base}/api/anything`)).status).toBe(404);
  });

  it("routes /api/readings to the readings list and keeps other /api paths closed", async () => {
    const r = await fetch(`${base}/api/readings`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await r.json()).toEqual({ readings: [], complete: true });
    expect((await fetch(`${base}/api/readings`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/api/readingsx`)).status).toBe(404);
  });

  it("routes /api/demo through the real socket with the content-type header", async () => {
    const post = (type: string) => fetch(`${base}/api/demo/retire`, { method: "POST", headers: { "content-type": type }, body: "{}" });
    expect((await post("text/plain")).status).toBe(415);
    const ok = await post("application/json");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, asExpected: true });
    expect((await fetch(`${base}/api/demo/status`)).status).toBe(200);
    expect((await fetch(`${base}/api/demox`)).status).toBe(404);
  });
});
