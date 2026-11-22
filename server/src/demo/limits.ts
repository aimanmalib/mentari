import type { DemoLimits } from "../config.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type Refusal = "disabled" | "busy" | "daily-limit" | "ip-limit";

/** A taken slot. `commit` counts the send against the limits; `release` frees the slot (always call it once). */
export interface Ticket {
  commit(): void;
  release(): void;
}

export type StartResult = { ok: true; ticket: Ticket } | { ok: false; reason: Refusal; retryAfterSeconds?: number };

/**
 * In-memory limits for the demo sender: concurrent sends, sends per visitor in a sliding hour, and sends per UTC day.
 * Only committed sends count, so a refused or unfunded attempt costs the visitor nothing. A restart clears the counts;
 * the sender balance floor still bounds the spend.
 */
export class DemoLimiter {
  readonly #limits: DemoLimits;
  readonly #now: () => number;
  readonly #perIp = new Map<string, number[]>();
  #running = 0;
  #day = -1;
  #today = 0;

  constructor(limits: DemoLimits, now: () => number = Date.now) {
    this.#limits = limits;
    this.#now = now;
  }

  get busy(): boolean {
    return this.#running >= this.#limits.maxConcurrent;
  }

  /** Sends left today across all visitors, and in the current hour for `ip`. */
  remaining(ip: string): { today: number; forYou: number } {
    const now = this.#now();
    this.#roll(now);
    const today = Math.max(0, this.#limits.perDay - this.#today);
    const forYou = Math.max(0, this.#limits.perIpPerHour - this.#recent(ip, now).length);
    return { today, forYou: Math.min(today, forYou) };
  }

  tryStart(ip: string): StartResult {
    const now = this.#now();
    this.#roll(now);
    if (!this.#limits.enabled) return { ok: false, reason: "disabled" };
    if (this.busy) return { ok: false, reason: "busy" };
    if (this.#today >= this.#limits.perDay) {
      return { ok: false, reason: "daily-limit", retryAfterSeconds: Math.ceil(((this.#day + 1) * DAY_MS - now) / 1000) };
    }
    const recent = this.#recent(ip, now);
    if (recent.length >= this.#limits.perIpPerHour) {
      return { ok: false, reason: "ip-limit", retryAfterSeconds: Math.ceil((recent[0]! + HOUR_MS - now) / 1000) };
    }
    this.#running += 1;
    let committed = false;
    let released = false;
    return {
      ok: true,
      ticket: {
        commit: () => {
          if (committed || released) return;
          committed = true;
          const at = this.#now();
          this.#roll(at);
          this.#today += 1;
          this.#perIp.set(ip, [...this.#recent(ip, at), at]);
        },
        release: () => {
          if (released) return;
          released = true;
          this.#running -= 1;
        },
      },
    };
  }

  #recent(ip: string, now: number): number[] {
    const kept = (this.#perIp.get(ip) ?? []).filter((t) => t > now - HOUR_MS);
    if (kept.length === 0) this.#perIp.delete(ip);
    else this.#perIp.set(ip, kept);
    return kept;
  }

  #roll(now: number): void {
    const day = Math.floor(now / DAY_MS);
    if (day === this.#day) return;
    this.#day = day;
    this.#today = 0;
    for (const ip of [...this.#perIp.keys()]) this.#recent(ip, now);
  }
}
