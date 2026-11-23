import { deriveUnifiedAccount, resolveSignBytesVersion, type UnifiedAccount } from "@qorechain/sdk";
import type { AppConfig } from "./config.js";
import { restLane } from "./lane.js";
import { actorFrom, type Actor, type Ctx, type NativeSettings } from "./native.js";

/** The account index config/app.json gives a role. A missing or doubled role is an error. */
export function indexOf(cfg: AppConfig, role: string): number {
  const hits = Object.entries(cfg.accounts).filter(([, r]) => r === role);
  if (hits.length !== 1) throw new Error(`config/app.json accounts: expected one "${role}", found ${hits.length}`);
  return Number(hits[0]![0]);
}

export interface NativeSession {
  ctx: Ctx;
  actors: Actor[];
  /** The actor of a role, or an error naming the role. */
  byRole(role: string): Actor;
  /** The derived account of each role, for its EVM address and keys. Stays in this process. */
  accounts: Record<string, UnifiedAccount>;
}

/** Derive the accounts of `roles` from the shared seed and connect them to the Native lane over public REST. */
export async function nativeSession(
  app: AppConfig & NativeSettings,
  mnemonic: string,
  roles: readonly string[],
): Promise<NativeSession> {
  const version = await resolveSignBytesVersion({ chainId: app.network.chainId, rest: app.network.rest });
  const accounts: Record<string, UnifiedAccount> = {};
  const actors = await Promise.all(
    roles.map(async (role) => {
      const account = await deriveUnifiedAccount(mnemonic, indexOf(app, role));
      accounts[role] = account;
      return actorFrom(role, account, app.network.chainId, version);
    }),
  );
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
  return { ctx, actors, byRole, accounts };
}
