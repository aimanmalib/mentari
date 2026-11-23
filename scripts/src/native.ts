import {
  EthNativeSigner,
  MSG_SEND_TYPE_URL,
  buildRegisterPqcKeyMsg,
  closeEvmWindowMsg,
  isRegisteredPqcKey,
  openEvmWindowMsg,
  signProofOfPossession,
  validateClassicalKeyForSender,
  type PqcKeypair,
  type SignBytesVersion,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { hexToBytes, parseUnits, type Hex } from "viem";
import type { Lane } from "./lane.js";

/** A Native-lane message as the SDK builders return it. */
export type EncodeObject = ReturnType<typeof closeEvmWindowMsg>;

/**
 * Account setup on the Native lane, before any EVM transaction: fund the Mentari accounts from the funder, register
 * each account's ML-DSA-87 key with a proof of possession, and open or close an account's EVM window. Every step reads
 * the chain first and sends only what is missing, so a stopped run can be repeated.
 */

export type GasKind = "send" | "registerKey" | "openWindow" | "closeWindow";

/** The `nativeLane`, `funding` and `windows` blocks of config/app.json. Amounts in QOR are decimal strings. */
export interface NativeSettings {
  nativeLane: {
    denom: string;
    decimals: number;
    gasPriceUqor: string;
    gas: Record<GasKind, number>;
    waitSeconds: number;
    pollSeconds: number;
  };
  funding: {
    funder: string;
    keepOnFunderQor: string;
    lowBalanceQor: string;
    lowBalanceRoles: string[];
    targetsQor: Record<string, string>;
  };
  windows: Record<string, WindowSpec>;
  /** The `contracts` block of config/app.json, where a window's `targets` are looked up by name. */
  contracts?: Record<string, unknown>;
}

/**
 * One window from config/app.json `windows`. `targets` names entries of `contracts`; a window with targets admits
 * only transactions to those addresses and refuses contract creation. No targets = no scope (needed to deploy).
 */
export interface WindowSpec {
  role: string;
  blocks: number;
  maxTxs: number;
  maxValueQor: string;
  targets?: string[];
}

/** The lowercase 0x addresses a window is narrowed to. A target whose contract address is not set is an error. */
export function windowTargets(spec: WindowSpec, contracts: Record<string, unknown> = {}): string[] {
  return (spec.targets ?? []).map((name) => {
    const address = contracts[name];
    if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address))
      throw new Error(`window target "${name}": config contracts.${name} is not an address`);
    return address.toLowerCase();
  });
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const x = new Set(a.map((s) => s.toLowerCase()));
  return x.size === new Set(b).size && b.every((s) => x.has(s));
};

/** One account the setup acts for. The keys stay in the process that built the signer. */
export interface Actor {
  role: string;
  cosmos: string;
  /** 33-byte compressed secp256k1 public key, sent with the key registration. */
  ecdsaPubkey: Uint8Array;
  pqc: PqcKeypair;
  /** Sign a tx. `classical` is true only for the key registration itself; everything else is signed hybrid. */
  sign(tx: SignRequest): Uint8Array;
}

export interface SignRequest {
  messages: EncodeObject[];
  fee: { amount: { denom: string; amount: string }[]; gas: string };
  accountNumber: bigint;
  sequence: bigint;
  classical: boolean;
}

/**
 * An actor for a unified eth-native account. It signs with the account's eth_secp256k1 key (and ML-DSA-87 key when
 * hybrid) through the SDK's eth-native signer, which cosmjs's standard signer cannot do for this key type.
 */
export function actorFrom(role: string, account: UnifiedAccount, chainId: string, version: SignBytesVersion): Actor {
  const hybrid = new EthNativeSigner(account, { signMode: "hybrid", signBytesVersion: version });
  const classical = new EthNativeSigner(account, { signMode: "classical", signBytesVersion: version });
  return {
    role,
    cosmos: account.cosmos,
    ecdsaPubkey: hexToBytes(account.publicKey as Hex),
    pqc: account.pqc,
    sign: (r) =>
      (r.classical ? classical : hybrid).sign({
        chainId,
        messages: r.messages,
        fee: r.fee,
        accountNumber: r.accountNumber,
        sequence: r.sequence,
      }).txRawBytes,
  };
}

export interface Ctx {
  lane: Lane;
  chainId: string;
  settings: NativeSettings;
  log: (line: string) => void;
}

/** QOR decimal string to base units, refusing anything that is not a plain non-negative decimal. */
export function toUqor(qor: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(qor)) throw new Error(`"${qor}" is not a QOR amount`);
  return parseUnits(qor, decimals);
}

/** Fee for `n` messages of one kind: gas limit from config, price from config, rounded up. */
export function feeFor(s: NativeSettings["nativeLane"], kind: GasKind, n = 1): SignRequest["fee"] {
  const gas = BigInt(s.gas[kind]) * BigInt(n);
  const [whole, frac = ""] = s.gasPriceUqor.split(".");
  const scale = 10n ** BigInt(frac.length);
  const price = BigInt(whole! + frac);
  const amount = (gas * price + scale - 1n) / scale;
  return { amount: [{ denom: s.denom, amount: amount.toString() }], gas: gas.toString() };
}

async function send(ctx: Ctx, actor: Actor, messages: EncodeObject[], kind: GasKind, classical = false): Promise<string> {
  const acct = await ctx.lane.account(actor.cosmos);
  if (!acct) throw new Error(`${actor.role} ${actor.cosmos} has no funds yet`);
  const fee = feeFor(ctx.settings.nativeLane, kind, messages.length);
  const bytes = actor.sign({ messages, fee, accountNumber: acct.accountNumber, sequence: acct.sequence, classical });
  const inc = await ctx.lane.broadcast(bytes);
  return inc.hash;
}

/**
 * Register the actor's ML-DSA-87 key unless it already is. A different key on chain stops the run: a second
 * registration is refused after the fee is charged, and every hybrid tx signed with this key would be refused.
 */
export async function registerKey(ctx: Ctx, actor: Actor): Promise<string | undefined> {
  const status = await ctx.lane.pqcStatus(actor.cosmos);
  if (status.registered) {
    if (isRegisteredPqcKey(status, actor.pqc.publicKey) === false)
      throw new Error(`${actor.role} ${actor.cosmos} has another ML-DSA-87 key registered`);
    ctx.log(`${actor.role}: key already registered`);
    return undefined;
  }
  validateClassicalKeyForSender(actor.cosmos, actor.ecdsaPubkey);
  const proof = signProofOfPossession({ chainId: ctx.chainId, account: actor.cosmos, keypair: actor.pqc });
  const msg = buildRegisterPqcKeyMsg(actor.cosmos, {
    pqcKeypair: actor.pqc,
    ecdsaPubkey: actor.ecdsaPubkey,
    proofOfPossession: proof,
  });
  const hash = await send(ctx, actor, [msg], "registerKey", true);
  const after = await ctx.lane.pqcStatus(actor.cosmos);
  if (!after.registered || after.possessionProven === false)
    throw new Error(`${actor.role}: registration ${hash} did not leave a proven key`);
  ctx.log(`${actor.role}: registered ML-DSA-87 key: ${hash}`);
  return hash;
}

export interface TopUp {
  role: string;
  to: string;
  amount: bigint;
}

/** What each account is short of its target. Accounts at or above target get nothing. */
export async function planTopUps(ctx: Ctx, recipients: Actor[]): Promise<TopUp[]> {
  const { targetsQor } = ctx.settings.funding;
  const { decimals } = ctx.settings.nativeLane;
  const out: TopUp[] = [];
  for (const r of recipients) {
    const target = targetsQor[r.role];
    if (target === undefined) throw new Error(`config funding.targetsQor has no "${r.role}"`);
    const short = toUqor(target, decimals) - (await ctx.lane.balance(r.cosmos));
    if (short > 0n) out.push({ role: r.role, to: r.cosmos, amount: short });
  }
  return out;
}

/**
 * Bring each recipient up to its target in one tx from the funder. Refuses before sending when the funder would end
 * below `keepOnFunderQor` (the part kept for deploy gas and for the second project).
 */
export async function fundAccounts(ctx: Ctx, funder: Actor, recipients: Actor[]): Promise<string | undefined> {
  const plan = await planTopUps(ctx, recipients);
  if (plan.length === 0) {
    ctx.log("every account is at its target");
    return undefined;
  }
  const { denom, decimals } = ctx.settings.nativeLane;
  const total = plan.reduce((a, t) => a + t.amount, 0n);
  const fee = BigInt(feeFor(ctx.settings.nativeLane, "send", plan.length).amount[0]!.amount);
  const keep = toUqor(ctx.settings.funding.keepOnFunderQor, decimals);
  const have = await ctx.lane.balance(funder.cosmos);
  if (have - total - fee < keep)
    throw new Error(`funder has ${have} ${denom}; the top-ups need ${total + fee} and ${keep} must stay`);

  await registerKey(ctx, funder);
  const messages: EncodeObject[] = plan.map((t) => ({
    typeUrl: MSG_SEND_TYPE_URL,
    value: { fromAddress: funder.cosmos, toAddress: t.to, amount: [{ denom, amount: t.amount.toString() }] },
  }));
  const hash = await send(ctx, funder, messages, "send");
  for (const t of plan) ctx.log(`sent ${t.amount} ${denom} to ${t.role} ${t.to}`);
  ctx.log(`top-up tx: ${hash}`);
  return hash;
}

/**
 * Open the named window from config unless the account already has a live window with the same scope (the same
 * targets, or none) and at least `need` left: by default the transactions and value the config asks for. A window
 * advances the account's EVM nonce, so EVM txs are signed after.
 */
export async function openWindow(
  ctx: Ctx,
  actor: Actor,
  name: string,
  need?: { txs: number; valueQor: string },
): Promise<string | undefined> {
  const spec = ctx.settings.windows[name];
  if (!spec) throw new Error(`config windows has no "${name}"`);
  if (spec.role !== actor.role) throw new Error(`window "${name}" belongs to ${spec.role}, not ${actor.role}`);
  const decimals = ctx.settings.nativeLane.decimals;
  const targets = windowTargets(spec, ctx.settings.contracts);
  const maxValue = toUqor(spec.maxValueQor, decimals);
  const w = await ctx.lane.window(actor.cosmos);
  const sameScope = !w.nativeOnly && sameSet(w.allowedTargets, targets);
  const wantTxs = BigInt(need?.txs ?? spec.maxTxs);
  const wantValue = need ? toUqor(need.valueQor, decimals) : maxValue;
  if (w.live && sameScope && w.remainingTxs >= wantTxs && w.remainingValue >= wantValue) {
    ctx.log(`${actor.role}: window already open for ${w.remainingBlocks} more blocks`);
    return undefined;
  }
  const msg = openEvmWindowMsg({
    sender: actor.cosmos,
    blocks: spec.blocks,
    maxTxs: spec.maxTxs,
    maxValue: maxValue.toString(),
    ...(targets.length > 0 ? { allowedTargets: targets } : {}),
  });
  const hash = await send(ctx, actor, [msg], "openWindow");
  const after = await ctx.lane.window(actor.cosmos);
  if (!after.live) throw new Error(`${actor.role}: window tx ${hash} left no live window`);
  if (!sameSet(after.allowedTargets, targets)) throw new Error(`${actor.role}: window tx ${hash} has another scope`);
  const scope = targets.length > 0 ? `to ${targets.join(", ")}` : "without a scope";
  ctx.log(`${actor.role}: opened window "${name}" ${scope} until block ${after.expiryHeight}: ${hash}`);
  return hash;
}

/** Close the actor's window when one is live. */
export async function closeWindow(ctx: Ctx, actor: Actor): Promise<string | undefined> {
  const w = await ctx.lane.window(actor.cosmos);
  if (!w.live) {
    ctx.log(`${actor.role}: no live window`);
    return undefined;
  }
  const hash = await send(ctx, actor, [closeEvmWindowMsg(actor.cosmos)], "closeWindow");
  ctx.log(`${actor.role}: closed window: ${hash}`);
  return hash;
}

export interface StatusRow {
  role: string;
  cosmos: string;
  balance: bigint;
  registered: boolean;
  possessionProven: boolean | undefined;
  windowLive: boolean;
  low: boolean;
}

/** Public state of each account, and whether a watched account is below the low-balance line. */
export async function readStatus(ctx: Ctx, actors: Pick<Actor, "role" | "cosmos">[]): Promise<StatusRow[]> {
  const { lowBalanceQor, lowBalanceRoles } = ctx.settings.funding;
  const low = toUqor(lowBalanceQor, ctx.settings.nativeLane.decimals);
  const rows: StatusRow[] = [];
  for (const a of actors) {
    const [balance, pqc, w] = await Promise.all([
      ctx.lane.balance(a.cosmos),
      ctx.lane.pqcStatus(a.cosmos),
      ctx.lane.window(a.cosmos),
    ]);
    rows.push({
      role: a.role,
      cosmos: a.cosmos,
      balance,
      registered: pqc.registered,
      possessionProven: pqc.possessionProven,
      windowLive: w.live,
      low: lowBalanceRoles.includes(a.role) && balance < low,
    });
  }
  return rows;
}
