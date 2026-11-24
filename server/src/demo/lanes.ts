import type { DemoLimits } from "../config.js";
import type { ChainState, DemoJob, DemoLane } from "./chain.js";

/**
 * Whether each demo job can be sent right now, and why not (decision 0030). The status route reports this and every
 * send checks it first, so the site never says "live" for a button whose transaction would fail.
 */

/** Why a job cannot be sent now. */
export type JobReason = "disabled" | "unavailable" | "low-funds" | "window-closed" | "no-certificates";

export interface JobStatus {
  ready: boolean;
  /** Null when the chain could not be read. */
  lane: DemoLane | null;
  reason: JobReason | null;
}

export const DEMO_JOBS: readonly DemoJob[] = ["retire", "cases", "grant"];

/** The status of one job. `state` is null when the chain is not configured or could not be read. */
export function jobStatus(job: DemoJob, limits: DemoLimits, state: ChainState | null): JobStatus {
  const lane = state?.lanes[job] ?? null;
  const no = (reason: JobReason): JobStatus => ({ ready: false, lane, reason });
  if (!limits.enabled) return no("disabled");
  if (!state) return no("unavailable");
  if (state.senderBalanceQor < limits.minSenderBalanceQor) return no("low-funds");
  if (lane === "evm-window") {
    if (!state.evmWindow) return no("unavailable");
    if (!state.evmWindow.live) return no("window-closed");
  }
  const needWh = job === "retire" ? limits.retireWh : job === "grant" ? limits.grantWh : 0;
  if (state.certificatesWh < needWh) return no("no-certificates");
  return { ready: true, lane, reason: null };
}

export function allJobs(limits: DemoLimits, state: ChainState | null): Record<DemoJob, JobStatus> {
  return Object.fromEntries(DEMO_JOBS.map((j) => [j, jobStatus(j, limits, state)])) as Record<DemoJob, JobStatus>;
}
