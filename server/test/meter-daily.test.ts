import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DailyMeter,
  nextRunAt,
  parseRunAt,
  retryAt,
  unconfiguredMeter,
  type DailyJob,
  type DailySchedule,
} from "../src/meter/daily.js";

// Frozen schedule for the tests, independent of config/meter.json.
const SCHEDULE: DailySchedule = { enabled: true, runAtMinute: 20, retryMinutes: 30 };
const at = (iso: string) => new Date(iso);

/** A job that records each call and answers from a queue (a number = sent, an Error = failure). */
function fakeJob(answers: Array<number | Error>, ready = true) {
  const calls: string[] = [];
  const job: DailyJob = {
    ready: () => ready,
    run: async () => {
      calls.push(new Date().toISOString());
      const a = answers.length > 1 ? answers.shift()! : answers[0]!;
      if (a instanceof Error) throw a;
      return a;
    },
  };
  return { job, calls };
}

describe("parseRunAt", () => {
  it("reads HH:MM as minutes after midnight UTC", () => {
    expect(parseRunAt("00:20")).toBe(20);
    expect(parseRunAt("23:59")).toBe(23 * 60 + 59);
    expect(parseRunAt("00:00")).toBe(0);
  });

  it.each(["0:20", "24:00", "12:60", "00:20Z", "", "noon"])("refuses %j", (text) => {
    expect(() => parseRunAt(text)).toThrow(/HH:MM/);
  });
});

describe("nextRunAt and retryAt", () => {
  it("is later today before the run time and tomorrow from the run time on", () => {
    expect(nextRunAt(at("2026-11-22T00:05:00Z"), 20).toISOString()).toBe("2026-11-22T00:20:00.000Z");
    expect(nextRunAt(at("2026-11-22T00:20:00Z"), 20).toISOString()).toBe("2026-11-23T00:20:00.000Z");
    expect(nextRunAt(at("2026-11-22T13:00:00Z"), 20).toISOString()).toBe("2026-11-23T00:20:00.000Z");
    expect(nextRunAt(at("2026-12-31T23:59:59Z"), 20).toISOString()).toBe("2027-01-01T00:20:00.000Z");
  });

  it("retries after the delay but never past the next daily run", () => {
    expect(retryAt(at("2026-11-22T00:21:00Z"), SCHEDULE).toISOString()).toBe("2026-11-22T00:51:00.000Z");
    expect(retryAt(at("2026-11-23T00:05:00Z"), SCHEDULE).toISOString()).toBe("2026-11-23T00:20:00.000Z");
  });
});

describe("DailyMeter", () => {
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-11-22T07:00:00Z"));
    lines.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("stays off and says why when the switch is off or the job is not configured", async () => {
    const { job, calls } = fakeJob([0]);
    const off = new DailyMeter(job, { ...SCHEDULE, enabled: false }, log);
    await off.start();
    expect(off.status()).toEqual({ state: "off", reason: "switched off in config/meter.json" });

    const unready = new DailyMeter(unconfiguredMeter, SCHEDULE, log);
    await unready.start();
    expect(unready.status().reason).toBe("contracts or meter keys not configured");
    await vi.advanceTimersByTimeAsync(3 * 86_400_000);
    expect(calls).toEqual([]);
    expect(lines.every((l) => l.startsWith("daily meter off: "))).toBe(true);
  });

  it("runs once at start, then every day at the configured UTC time", async () => {
    const { job, calls } = fakeJob([3, 3, 0]);
    const m = new DailyMeter(job, SCHEDULE, log);
    await m.start();
    expect(m.status()).toMatchObject({
      state: "waiting",
      next: "2026-11-23T00:20:00.000Z",
      last: { at: "2026-11-22T07:00:00.000Z", ok: true, sent: 3 },
    });
    await vi.advanceTimersByTimeAsync(2 * 86_400_000);
    expect(calls).toEqual(["2026-11-22T07:00:00.000Z", "2026-11-23T00:20:00.000Z", "2026-11-24T00:20:00.000Z"]);
    expect(m.status().last).toEqual({ at: "2026-11-24T00:20:00.000Z", ok: true, sent: 0 });
    m.stop();
  });

  it("retries a failed run after retryMinutes, then goes back to the daily time", async () => {
    const { job, calls } = fakeJob([new Error("rpc down\nstack line"), 3, 3]);
    const m = new DailyMeter(job, SCHEDULE, log);
    await m.start();
    expect(m.status()).toMatchObject({ state: "waiting", next: "2026-11-22T07:30:00.000Z", last: { ok: false, error: "rpc down" } });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(calls).toEqual(["2026-11-22T07:00:00.000Z", "2026-11-22T07:30:00.000Z"]);
    expect(m.status().next).toBe("2026-11-23T00:20:00.000Z");
    expect(lines[0]).toBe("daily meter failed: rpc down; next try 2026-11-22T07:30:00.000Z");
    m.stop();
  });

  it("does not retry past the next daily run", async () => {
    vi.setSystemTime(at("2026-11-23T00:05:00Z"));
    const { job } = fakeJob([new Error("x"), 1]);
    const m = new DailyMeter(job, SCHEDULE, log);
    await m.start();
    expect(m.status().next).toBe("2026-11-23T00:20:00.000Z");
    m.stop();
  });

  it("never runs two at once", async () => {
    let release!: (n: number) => void;
    let running = 0;
    let most = 0;
    const job: DailyJob = {
      ready: () => true,
      run: () => {
        running++;
        most = Math.max(most, running);
        return new Promise<number>((r) => (release = r)).finally(() => running--);
      },
    };
    const m = new DailyMeter(job, SCHEDULE, log);
    const first = m.start();
    const second = m.start();
    expect(second).toBe(first);
    expect(m.status().state).toBe("running");
    release(1);
    await first;
    expect(most).toBe(1);
    m.stop();
  });

  it("a run that finishes after stop() schedules nothing", async () => {
    let release!: (n: number) => void;
    let calls = 0;
    const job: DailyJob = {
      ready: () => true,
      run: () => {
        calls++;
        return new Promise<number>((r) => (release = r));
      },
    };
    const m = new DailyMeter(job, SCHEDULE, log);
    const first = m.start();
    m.stop();
    release(2);
    await first;
    expect(m.status()).toMatchObject({ state: "off", reason: "stopped", last: { ok: true, sent: 2 } });
    await vi.advanceTimersByTimeAsync(3 * 86_400_000);
    expect(calls).toBe(1);
  });

  it("stop() cancels the next run and a long error is cut short", async () => {
    const { job, calls } = fakeJob([new Error("e".repeat(500))]);
    const m = new DailyMeter(job, SCHEDULE, log);
    await m.start();
    expect(m.status().last?.error).toHaveLength(201);
    m.stop();
    expect(m.status()).toMatchObject({ state: "off", reason: "stopped" });
    await vi.advanceTimersByTimeAsync(3 * 86_400_000);
    expect(calls).toHaveLength(1);
  });
});
