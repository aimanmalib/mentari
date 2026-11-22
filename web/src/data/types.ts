/** Shapes shared by the live chain reader and the sample data. Amounts are watt-hours (1 MTR = 1 Wh). */

export interface Totals {
  minted: bigint;
  retired: bigint;
  supply: bigint;
}

export interface SystemInfo {
  id: number;
  label: string;
  meter: string;
  producer: string;
  capacityW: number;
  firstDay: number;
  /** Largest reading the contract accepts for one day, in Wh. */
  maxWh: bigint;
}

export interface Retirement {
  n: number;
  holder: string;
  wh: bigint;
  receiptId: number;
  timestamp: number;
}

export interface Receipt {
  id: number;
  sender: string;
  note: string;
  height: number;
}

/** Result of reading one retirement on the EVM side and its receipt on the Native side. */
export interface PairCheck {
  n: number;
  receiptId: number;
  ok: boolean;
  /** Empty when ok; otherwise the reasons, as stable codes the page translates. */
  problems: PairProblem[];
}

export type PairProblem = "missing-receipt" | "wrong-sender" | "wrong-note";

export type Agreement =
  | { state: "empty" }
  | { state: "agree"; checked: number; total: number }
  | { state: "disagree"; checked: number; total: number; failed: PairCheck[] };

export interface RegistrySnapshot {
  /** "live" reads testnet; "sample" is local example data shaped like the testnet evidence. */
  source: "live" | "sample";
  contract: string;
  contractNative: string;
  totals: Totals;
  retirementsCount: number;
  systems: SystemInfo[];
  pairs: PairCheck[];
  agreement: Agreement;
  readAt: number;
}
