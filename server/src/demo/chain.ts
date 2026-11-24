/** What a visitor can ask the demo sender to do. Each maps to one recorded case in `evidence/testnet.json`. */
export type DemoAction = "retire" | "case-b" | "case-c" | "case-d";

/** The three jobs the demo account does, each with its own route switch in `config/app.json nativeRoute`. */
export type DemoJob = "retire" | "cases" | "grant";

/** How a job reaches the contracts: one hybrid-signed Native `MsgCrossVMCall`, or an EVM transaction through the scoped window. */
export type DemoLane = "native" | "evm-window";

export function jobOf(action: DemoAction): Exclude<DemoJob, "grant"> {
  return action === "retire" ? "retire" : "cases";
}

/** The demo account's EVM window as the chain reports it. `untilBlock` is null when no window is stored. */
export interface EvmWindowState {
  live: boolean;
  untilBlock: number | null;
}

/** What the demo account can send right now, read from the chain in one go. */
export interface ChainState {
  lanes: Record<DemoJob, DemoLane>;
  senderBalanceQor: number;
  /** Certificates (Wh) the demo account holds in `Mentari`. */
  certificatesWh: number;
  /** The demo account's EVM window, or null when it could not be read. */
  evmWindow: EvmWindowState | null;
}

/**
 * One sent transaction: an EVM transaction, or a Native one (`MsgCrossVMCall`, decision 0026) that ran the EVM
 * call inside it. `status` is the mined status; a failure case is expected to come back `reverted`.
 */
export type SendResult = { evmTx: string; status: "success" | "reverted" } | { cosmosTx: string; status: "success" | "reverted" };

/** The hash field of a result, as the API answers it. */
export function txField(sent: SendResult): { evmTx: string } | { cosmosTx: string } {
  return "cosmosTx" in sent ? { cosmosTx: sent.cosmosTx } : { evmTx: sent.evmTx };
}

/** Both ledgers at one moment: Native receipts in the receipts book and EVM retirements in `Mentari`. */
export interface LedgerCounts {
  receipts: number;
  retirements: number;
}

/**
 * The chain side of the demo, kept behind an interface so the HTTP rules are tested with a fake and no key.
 * The live adapter (account 7, viem) is wired in when the contracts are on the testnet. It must send the failure
 * cases without a gas estimate, because an estimate of a reverting call fails before anything is mined.
 */
export interface DemoChain {
  /** False until the contract addresses and the sender key are configured. */
  ready(): boolean;
  /** Balance, certificates, EVM window and the lane of each job, so a send that cannot work is never tried. */
  state(): Promise<ChainState>;
  counts(): Promise<LedgerCounts>;
  send(action: DemoAction, opts: { retireWh: number }): Promise<SendResult>;
  /** Whether `account` may receive certificates (`Mentari.isQuantumReady`: a registered ML-DSA-87 key). */
  isQuantumReady(account: string): Promise<boolean>;
  /** `Mentari.transfer(to, wh)` from the demo account, so a visitor can retire from their own wallet. */
  grant(to: string, wh: number): Promise<SendResult>;
}

class NotConfigured extends Error {
  constructor() {
    super("demo sender is not configured");
  }
}

/** Used until the contracts are deployed: every request falls back to the recorded evidence. */
export const unconfiguredChain: DemoChain = {
  ready: () => false,
  state: () => Promise.reject(new NotConfigured()),
  counts: () => Promise.reject(new NotConfigured()),
  send: () => Promise.reject(new NotConfigured()),
  isQuantumReady: () => Promise.reject(new NotConfigured()),
  grant: () => Promise.reject(new NotConfigured()),
};
