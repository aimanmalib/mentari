/** What a visitor can ask the demo sender to do. Each maps to one recorded case in `evidence/testnet.json`. */
export type DemoAction = "retire" | "case-b" | "case-c" | "case-d";

export interface SendResult {
  /** EVM transaction hash. */
  evmTx: string;
  /** Mined status. A failure case is expected to come back `reverted`. */
  status: "success" | "reverted";
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
  senderBalanceQor(): Promise<number>;
  counts(): Promise<LedgerCounts>;
  send(action: DemoAction, opts: { retireWh: number }): Promise<SendResult>;
}

class NotConfigured extends Error {
  constructor() {
    super("demo sender is not configured");
  }
}

/** Used until the contracts are deployed: every request falls back to the recorded evidence. */
export const unconfiguredChain: DemoChain = {
  ready: () => false,
  senderBalanceQor: () => Promise.reject(new NotConfigured()),
  counts: () => Promise.reject(new NotConfigured()),
  send: () => Promise.reject(new NotConfigured()),
};
