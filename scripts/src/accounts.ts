import { closeSync, constants, mkdirSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { deriveUnifiedAccount, generateMnemonic } from "@qorechain/sdk";

/** Shape of the accounts file. The phrase never leaves this file. */
export interface AccountsFile {
  version: 1;
  createdAt: string;
  mnemonic: string;
}

export interface PublicAccount {
  index: number;
  role: string;
  cosmos: string;
  evm: string;
}

export const ACCOUNTS_ENV = "MENTARI_ACCOUNTS";

/**
 * Resolve the accounts file path from the environment. It must be absolute and must not sit
 * inside the repository, so a stray `git add` can never pick it up.
 */
export function accountsPath(env: NodeJS.ProcessEnv, repoRoot: string): string {
  const p = env[ACCOUNTS_ENV];
  if (!p) throw new Error(`${ACCOUNTS_ENV} is not set (see .env.example)`);
  if (!isAbsolute(p)) throw new Error(`${ACCOUNTS_ENV} must be an absolute path`);
  const rel = relative(resolve(repoRoot), resolve(p));
  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    throw new Error(`${ACCOUNTS_ENV} points inside the repository; keep it outside`);
  }
  return p;
}

/** Create the file with a fresh 24-word phrase. Never overwrites: fails if it exists. */
export function createAccountsFile(path: string, now: Date = new Date()): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body: AccountsFile = { version: 1, createdAt: now.toISOString(), mnemonic: generateMnemonic(256) };
  // O_EXCL: a second run, or a race with another process, cannot replace an existing phrase.
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeSync(fd, JSON.stringify(body, null, 2) + "\n");
  } finally {
    closeSync(fd);
  }
}

/** Read the file, refusing it when group or others can read it. */
export function readAccountsFile(path: string): AccountsFile {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`accounts file mode is ${mode.toString(8)}; run chmod 600 on it`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<AccountsFile>;
  if (parsed.version !== 1 || typeof parsed.mnemonic !== "string") {
    throw new Error("accounts file has an unknown shape");
  }
  return parsed as AccountsFile;
}

/** Derive only the public addresses for the given indices. */
export async function publicAccounts(
  file: AccountsFile,
  roles: Record<string, string>,
  indices: number[],
): Promise<PublicAccount[]> {
  const out: PublicAccount[] = [];
  for (const index of indices) {
    const a = await deriveUnifiedAccount(file.mnemonic, index);
    out.push({ index, role: roles[String(index)] ?? "", cosmos: a.cosmos, evm: a.evm });
  }
  return out;
}
