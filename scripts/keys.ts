/**
 * keys: create (once) or open the shared accounts file and print PUBLIC addresses only.
 *
 *   pnpm keys              print addresses; creates the file on first run
 *   pnpm keys --balances   also read each EVM balance from the public RPC
 *
 * The phrase and private keys are never printed, logged or written anywhere else.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { accountsPath, createAccountsFile, publicAccounts, readAccountsFile } from "./src/accounts.js";
import { evmBalance, formatAmount } from "./src/balance.js";
import { accountIndices, loadAppConfig } from "./src/config.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function main(argv: string[]): Promise<void> {
  const withBalances = argv.includes("--balances");
  const cfg = loadAppConfig();
  const path = accountsPath(process.env, repoRoot);
  if (!existsSync(path)) {
    createAccountsFile(path);
    console.log("created a new accounts file (mode 600); back it up offline");
  }
  const accounts = await publicAccounts(readAccountsFile(path), cfg.accounts, accountIndices(cfg));
  for (const a of accounts) {
    let line = `${String(a.index).padStart(2)}  ${a.cosmos}  ${a.evm}  ${a.role}`;
    if (withBalances) {
      const wei = await evmBalance(cfg.network.evmRpc, a.evm);
      line += `  ${formatAmount(wei, cfg.network.evmDecimals, cfg.network.symbol)}`;
    }
    console.log(line);
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(`keys: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
