/**
 * The daily meter run. Once a day, at a UTC time from `config/meter.json`, the server asks the chain side to
 * attest every finished day it has not seen yet. The job itself is injected (the chain side reads the chain first,
 * so running it twice sends nothing), which keeps the timing rules testable with a fake clock and no key.
 */

/** What the scheduler runs. The live job attests yesterday for each simulated system. */
export interface DailyJob {
  /** False until the contract address and the meter keys are configured. */
  ready(): boolean;
  /** Attest what is missing. Resolves with the number of attestations sent (0 when nothing was missing). */
  run(): Promise<number>;
}

/** Block `daily` of `config/meter.json`. */
export interface DailySchedule {
  /** Off switch for the daily run. */
  enabled: boolean;
  /** Minutes after 00:00 UTC, parsed from "HH:MM". */
  runAtMinute: number;
  /** After a failed run, try again this many minutes later, but never past the next daily run. */
  retryMinutes: number;
}

export interface DailyRun {
  at: string;
  ok: boolean;
  sent?: number;
  error?: string;
}

export interface DailyStatus {
  state: "off" | "waiting" | "running";
  /** Why the run is off, when it is. */
  reason?: string;
  last?: DailyRun;
  next?: string;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const MAX_ERROR_CHARS = 200;

/** "HH:MM" (24 hour, UTC) to minutes after midnight. */
export function parseRunAt(text: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!m) throw new Error(`expected a UTC time as HH:MM, got "${text}"`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** The first moment strictly after `now` whose UTC time of day is `runAtMinute`. */
export function nextRunAt(now: Date, runAtMinute: number): Date {
  const midnight = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  const today = midnight + runAtMinute * MINUTE_MS;
  return new Date(today > now.getTime() ? today : today + DAY_MS);
}

/** When to run after a failure at `now`: after the retry delay, or at the next daily run if that comes first. */
export function retryAt(now: Date, schedule: DailySchedule): Date {
  const retry = now.getTime() + schedule.retryMinutes * MINUTE_MS;
  return new Date(Math.min(retry, nextRunAt(now, schedule.runAtMinute).getTime()));
}

/** First line of an error message, cut short. Chain errors carry public data only; this keeps logs small. */
function shortError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const line = text.split("\n")[0] ?? "";
  return line.length > MAX_ERROR_CHARS ? `${line.slice(0, MAX_ERROR_CHARS)}…` : line;
}

/**
 * Runs the job once at start (a restart after a missed day catches up), then every day at the configured time.
 * One run at a time. A failed run is retried; a successful one waits for the next day.
 */
export class DailyMeter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private current: Promise<void> | undefined;
  private stopped = false;
  private st: DailyStatus = { state: "off", reason: "not started" };

  constructor(
    private readonly job: DailyJob,
    private readonly schedule: DailySchedule,
    private readonly log: (line: string) => void = console.log,
    private readonly now: () => Date = () => new Date(),
  ) {}

  status(): DailyStatus {
    return { ...this.st };
  }

  /** Starts the run, or stays off and says why. Returns the first run so tests can wait for it. */
  start(): Promise<void> {
    if (!this.schedule.enabled) return this.off("switched off in config/meter.json");
    if (!this.job.ready()) return this.off("contracts or meter keys not configured");
    this.stopped = false;
    return this.tick();
  }

  /** Stops the timer. A run already sending finishes on its own. */
  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.st = this.withLast({ state: "off", reason: "stopped" });
  }

  /** A new status that keeps the last run. */
  private withLast(st: DailyStatus): DailyStatus {
    return this.st.last ? { ...st, last: this.st.last } : st;
  }

  private off(reason: string): Promise<void> {
    this.st = { state: "off", reason };
    this.log(`daily meter off: ${reason}`);
    return Promise.resolve();
  }

  private tick(): Promise<void> {
    if (this.current) return this.current;
    this.current = this.runOnce().finally(() => {
      this.current = undefined;
    });
    return this.current;
  }

  private async runOnce(): Promise<void> {
    this.st = this.withLast({ state: "running" });
    const at = this.now();
    let next: Date;
    try {
      const sent = await this.job.run();
      this.st.last = { at: at.toISOString(), ok: true, sent };
      next = nextRunAt(this.now(), this.schedule.runAtMinute);
      this.log(`daily meter: ${sent} attestation(s) sent; next run ${next.toISOString()}`);
    } catch (err) {
      const error = shortError(err);
      this.st.last = { at: at.toISOString(), ok: false, error };
      next = retryAt(this.now(), this.schedule);
      this.log(`daily meter failed: ${error}; next try ${next.toISOString()}`);
    }
    if (this.stopped) return;
    this.st = this.withLast({ state: "waiting", next: next.toISOString() });
    const delay = Math.max(0, next.getTime() - this.now().getTime());
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref?.();
  }
}

class NotConfigured extends Error {
  constructor() {
    super("daily meter is not configured");
  }
}

/** Used until the contracts are on the testnet and the meter keys are mounted: the daily run stays off. */
export const unconfiguredMeter: DailyJob = {
  ready: () => false,
  run: () => Promise.reject(new NotConfigured()),
};
