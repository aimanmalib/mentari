import { describe, expect, it } from "vitest";
import { DemoLimiter } from "../src/demo/limits.js";
import { demoLimits } from "./fixture.js";

const DAY = 86_400_000;
const HOUR = 3_600_000;

function clock(start = 10 * DAY + 1000) {
  const c = { t: start, now: () => c.t };
  return c;
}

/** Start, count and finish one send for `ip`. */
function use(l: DemoLimiter, ip: string) {
  const r = l.tryStart(ip);
  if (!r.ok) return r;
  r.ticket.commit();
  r.ticket.release();
  return r;
}

describe("DemoLimiter", () => {
  it("allows one send at a time and frees the slot on release", () => {
    const l = new DemoLimiter(demoLimits({ perIpPerHour: 9, perDay: 9 }), clock().now);
    const a = l.tryStart("1.1.1.1");
    expect(a.ok).toBe(true);
    expect(l.busy).toBe(true);
    expect(l.tryStart("2.2.2.2")).toEqual({ ok: false, reason: "busy" });
    if (a.ok) {
      a.ticket.release();
      a.ticket.release();
    }
    expect(l.busy).toBe(false);
    expect(l.tryStart("2.2.2.2").ok).toBe(true);
  });

  it("honours a larger maxConcurrent from config", () => {
    const l = new DemoLimiter(demoLimits({ maxConcurrent: 2 }), clock().now);
    expect(l.tryStart("a").ok).toBe(true);
    expect(l.tryStart("b").ok).toBe(true);
    expect(l.tryStart("c")).toMatchObject({ reason: "busy" });
  });

  it("limits each visitor per sliding hour and says when to retry", () => {
    const c = clock();
    const l = new DemoLimiter(demoLimits({ perIpPerHour: 2, perDay: 99 }), c.now);
    use(l, "a");
    c.t += 10 * 60_000;
    use(l, "a");
    const refused = l.tryStart("a");
    expect(refused).toEqual({ ok: false, reason: "ip-limit", retryAfterSeconds: 50 * 60 });
    expect(l.tryStart("b").ok).toBe(true);
  });

  it("frees a visitor's slot exactly one hour after their oldest send", () => {
    const c = clock();
    const l = new DemoLimiter(demoLimits({ perIpPerHour: 1, perDay: 99 }), c.now);
    use(l, "a");
    c.t += HOUR - 1;
    expect(l.tryStart("a")).toMatchObject({ reason: "ip-limit", retryAfterSeconds: 1 });
    c.t += 1;
    expect(l.tryStart("a").ok).toBe(true);
  });

  it("stops everyone after perDay sends and reopens at 00:00 UTC", () => {
    const c = clock(10 * DAY + 23 * HOUR);
    const l = new DemoLimiter(demoLimits({ perIpPerHour: 99, perDay: 3 }), c.now);
    for (const ip of ["a", "b", "c"]) expect(use(l, ip).ok).toBe(true);
    expect(l.tryStart("d")).toEqual({ ok: false, reason: "daily-limit", retryAfterSeconds: 3600 });
    expect(l.remaining("d")).toEqual({ today: 0, forYou: 0 });
    c.t = 11 * DAY;
    expect(l.remaining("d")).toEqual({ today: 3, forYou: 3 });
    expect(l.tryStart("d").ok).toBe(true);
  });

  it("counts only committed sends", () => {
    const l = new DemoLimiter(demoLimits({ perIpPerHour: 1, perDay: 1 }), clock().now);
    for (let i = 0; i < 5; i++) {
      const r = l.tryStart("a");
      if (r.ok) r.ticket.release();
    }
    expect(l.remaining("a")).toEqual({ today: 1, forYou: 1 });
    const r = l.tryStart("a");
    if (r.ok) {
      r.ticket.commit();
      r.ticket.commit();
      r.ticket.release();
    }
    expect(l.remaining("a")).toEqual({ today: 0, forYou: 0 });
  });

  it("refuses everything when the switch is off", () => {
    const l = new DemoLimiter(demoLimits({ enabled: false }), clock().now);
    expect(l.tryStart("a")).toEqual({ ok: false, reason: "disabled" });
    expect(l.busy).toBe(false);
  });
});
