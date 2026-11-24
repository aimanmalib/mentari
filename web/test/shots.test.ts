import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shotList } from "../og/shots.js";
import app from "../../config/app.json" with { type: "json" };

const DEVICES = ["iPhone 13"];
const ok = { path: "/", ready: ".x", out: "docs/images/a.png", width: 10, height: 10 };

/** Width and height from the IHDR chunk of a PNG file in the repository. */
function pngSize(rel: string): { width: number; height: number } {
  const head = readFileSync(new URL(`../../${rel}`, import.meta.url)).subarray(0, 24);
  expect(head.subarray(12, 16).toString("latin1")).toBe("IHDR");
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

describe("web.shots", () => {
  it("accepts the list in config/app.json", () => {
    expect(shotList(app.web.shots.list, DEVICES).length).toBe(app.web.shots.list.length);
  });

  it("refuses entries that would write outside the repository, repeat a file or have no size", () => {
    expect(() => shotList([], DEVICES)).toThrow("non-empty");
    expect(() => shotList([{ ...ok, out: "../x.png" }], DEVICES)).toThrow(".out");
    expect(() => shotList([{ ...ok, out: "/tmp/x.png" }], DEVICES)).toThrow(".out");
    expect(() => shotList([ok, ok], DEVICES)).toThrow("twice");
    expect(() => shotList([{ ...ok, width: undefined }], DEVICES)).toThrow("width and height");
    expect(() => shotList([{ ...ok, device: "Nokia 3310" }], DEVICES)).toThrow("unknown device");
    expect(() => shotList([{ ...ok, path: "try" }], DEVICES)).toThrow(".path");
  });

  it("each committed shot without a device has the configured size", () => {
    for (const s of shotList(app.web.shots.list, DEVICES)) {
      if (s.device === undefined) expect(pngSize(s.out), s.out).toEqual({ width: s.width, height: s.height });
    }
  });
});
