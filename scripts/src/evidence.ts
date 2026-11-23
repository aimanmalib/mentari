import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { StatusRow } from "./native.js";

/** One account in `evidence/accounts.json`: public data only, read from the public REST endpoint. */
export interface AccountRecord {
  role: string;
  evm: string;
  cosmos: string;
  balanceUqor: string;
  pqcKeyRegistered: boolean;
  possessionProven: boolean | null;
  evmWindowOpen: boolean;
}

export interface AccountsEvidence {
  chainId: string;
  rest: string;
  readAt: string;
  accounts: AccountRecord[];
}

/**
 * Turn the status rows into the evidence record. Every role must have an EVM address, so the file can never list an
 * account a reader cannot look up on the EVM side.
 */
export function accountsEvidence(
  rows: readonly StatusRow[],
  evmByRole: Readonly<Record<string, string>>,
  meta: { chainId: string; rest: string; readAt: Date },
): AccountsEvidence {
  return {
    chainId: meta.chainId,
    rest: meta.rest,
    readAt: meta.readAt.toISOString(),
    accounts: rows.map((r) => {
      const evm = evmByRole[r.role];
      if (!evm) throw new Error(`no EVM address for role "${r.role}"`);
      return {
        role: r.role,
        evm,
        cosmos: r.cosmos,
        balanceUqor: r.balance.toString(),
        pqcKeyRegistered: r.registered,
        possessionProven: r.possessionProven ?? null,
        evmWindowOpen: r.windowLive,
      };
    }),
  };
}

/** Write a JSON evidence file with a trailing newline, creating the folder when needed. */
export function writeEvidence(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
