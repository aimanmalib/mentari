/**
 * native: get the Mentari accounts ready on the Native lane before any EVM transaction.
 *
 *   pnpm native status          balance, ML-DSA-87 key and EVM window of each account (exit 3 when a watched
 *                               account is below the low-balance line in config/app.json)
 *   pnpm native fund            register the funder's key, then top each account up to its target in one tx
 *   pnpm native keys            register the ML-DSA-87 key, with proof of possession, of every account that has funds
 *   pnpm native window <name>   open the EVM window named in config/app.json `windows`
 *   pnpm native close <role>    close that account's EVM window
 *
 * Accounts come from the shared accounts file (MENTARI_ACCOUNTS) by the roles in config/app.json. Output is public
 * data only: roles, addresses, amounts and transaction hashes.
 */
import { fileURLToPath } from "node:url";
import { deriveUnifiedAccount, resolveSignBytesVersion } from "@qorechain/sdk";
import { accountsPath, readAccountsFile } from "./src/accounts.js";
import { loadAppConfig, type AppConfig } from "./src/config.js";
import { restLane } from "./src/lane.js";
import {
  actorFrom,
  closeWindow,
  fundAccounts,
  openWindow,
  readStatus,
  registerKey,
  type Actor,
  type Ctx,
  type NativeSettings,
} from "./src/native.js";
import { indexOf } from "./testnet.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const USAGE = "usage: pnpm native status | fund | keys | window <name> | close <role>";

/** Exit code when a watched account is below the low-balance line, so a scheduler can alert on it. */
export const EXIT_LOW = 3;

/** The roles this command acts for: the funder first, then every role with a funding target. */
export function nativeRoles(s: NativeSettings): string[] {
  return [s.funding.funder, ...Object.keys(s.funding.targetsQor).filter((r) => r !== s.funding.funder)];
}

async function main(argv: string[]): Promise<number> {
  const [cmd, arg] = argv;
  const app = loadAppConfig() as AppConfig & NativeSettings;
  const { mnemonic } = readAccountsFile(accountsPath(process.env, repoRoot));
  const version = await resolveSignBytesVersion({ chainId: app.network.chainId, rest: app.network.rest });
  const actor = async (role: string): Promise<Actor> =>
    actorFrom(role, await deriveUnifiedAccount(mnemonic, indexOf(app, role)), app.network.chainId, version);
  const actors = await Promise.all(nativeRoles(app).map(actor));
  const byRole = (role: string): Actor => {
    const a = actors.find((x) => x.role === role);
    if (!a) throw new Error(`no account with role "${role}"`);
    return a;
  };
  const ctx: Ctx = {
    lane: restLane({
      rest: app.network.rest,
      denom: app.nativeLane.denom,
      waitMs: app.nativeLane.waitSeconds * 1000,
      pollMs: app.nativeLane.pollSeconds * 1000,
    }),
    chainId: app.network.chainId,
    settings: app,
    log: (line) => console.log(line),
  };

  switch (cmd) {
    case "status": {
      const rows = await readStatus(ctx, actors);
      for (const r of rows) {
        const key = r.registered ? (r.possessionProven === false ? "key unproven" : "key ok") : "no key";
        const line = `${r.role.padEnd(20)} ${r.cosmos}  ${r.balance} ${app.nativeLane.denom}  ${key}  window ${r.windowLive ? "open" : "closed"}`;
        console.log(r.low ? `${line}  LOW` : line);
      }
      return rows.some((r) => r.low) ? EXIT_LOW : 0;
    }
    case "fund":
      await fundAccounts(ctx, byRole(app.funding.funder), actors.slice(1));
      return 0;
    case "keys":
      for (const a of actors) {
        if ((await ctx.lane.account(a.cosmos)) === undefined) console.log(`${a.role}: no funds yet, skipped`);
        else await registerKey(ctx, a);
      }
      return 0;
    case "window": {
      const spec = arg ? app.windows[arg] : undefined;
      if (!spec) throw new Error(`name one of: ${Object.keys(app.windows).join(", ")}`);
      await openWindow(ctx, byRole(spec.role), arg!);
      return 0;
    }
    case "close":
      if (!arg) throw new Error(USAGE);
      await closeWindow(ctx, byRole(arg));
      return 0;
    default:
      throw new Error(USAGE);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`native: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
