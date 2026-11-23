import { fetchEvmWindow, fetchPqcStatus, type EvmWindow, type PqcStatus } from "@qorechain/sdk";

/**
 * The Native lane as the account setup needs it, read and written over the public REST endpoint only: account number
 * and sequence, the uqor balance, the ML-DSA-87 key status, the EVM window, and broadcasting signed bytes. No key
 * material passes through here; the caller signs.
 */

export interface LaneAccount {
  accountNumber: bigint;
  sequence: bigint;
}

export interface Included {
  hash: string;
  height: number;
  gasUsed: number;
}

export interface Lane {
  /** Account number and sequence, or undefined when the chain has never seen the address (no funds yet). */
  account(address: string): Promise<LaneAccount | undefined>;
  /** Balance in the base denom (uqor). */
  balance(address: string): Promise<bigint>;
  pqcStatus(address: string): Promise<PqcStatus>;
  window(address: string): Promise<EvmWindow>;
  /** Broadcast signed tx bytes and wait until the tx is in a block. Throws when it is refused or fails. */
  broadcast(txBytes: Uint8Array): Promise<Included>;
}

/** A lane that can also report a failed transaction instead of throwing, for experiments whose answer may be "no". */
export interface Submitter {
  /** Broadcast signed tx bytes and report what the chain said, success or not. Throws only when there is no answer. */
  submit(txBytes: Uint8Array): Promise<Submitted>;
}

/**
 * What the chain did with a transaction. `stage` is `check` when the node refused it before any block (it then has
 * a hash but no height) and `block` when it was included, with `code` 0 for success.
 */
export interface Submitted {
  hash: string;
  stage: "check" | "block";
  code: number;
  codespace: string;
  log: string;
  height: number | null;
  gasUsed: number | null;
  events: { type: string; attributes: { key: string; value: string }[] }[];
}

export type Fetch = typeof fetch;

export interface RestLaneOptions {
  rest: string;
  denom: string;
  waitMs: number;
  pollMs: number;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** One raw REST answer: status and parsed body (or undefined when the body is not JSON). */
async function getJson(f: Fetch, url: string): Promise<{ status: number; body: unknown }> {
  const res = await f(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

function obj(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}

/**
 * Account number and sequence from `/cosmos/auth/v1beta1/accounts/{address}`. The account is either a plain
 * `BaseAccount` or a type that wraps one as `base_account`.
 */
export function parseAccount(body: unknown): LaneAccount {
  const account = obj(obj(body).account);
  const base = account.base_account ? obj(account.base_account) : account;
  const num = base.account_number;
  const seq = base.sequence ?? "0";
  if (typeof num !== "string" || typeof seq !== "string") throw new Error("account answer has no account_number");
  return { accountNumber: BigInt(num), sequence: BigInt(seq) };
}

function isNotFound(status: number, body: unknown): boolean {
  if (status === 404) return true;
  const b = obj(body);
  return b.code === 5 || (typeof b.message === "string" && b.message.includes("not found"));
}

export function restLane(opts: RestLaneOptions): Lane & Submitter {
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const base = opts.rest.replace(/\/+$/, "");
  const windowFetch = (url: string) => f(url, { headers: { accept: "application/json" } });

  const submit = async (txBytes: Uint8Array): Promise<Submitted> => {
    const res = await f(`${base}/cosmos/tx/v1beta1/txs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_bytes: Buffer.from(txBytes).toString("base64"), mode: "BROADCAST_MODE_SYNC" }),
    });
    const sent = obj(obj(await res.json().catch(() => undefined)).tx_response);
    const hash = sent.txhash;
    if (!res.ok || typeof hash !== "string") throw new Error(`broadcast: HTTP ${res.status}`);
    if (sent.code !== 0) return submitted(hash, "check", sent);

    const deadline = now() + opts.waitMs;
    for (;;) {
      const { status, body } = await getJson(f, `${base}/cosmos/tx/v1beta1/txs/${hash}`);
      if (status === 200) return submitted(hash, "block", obj(obj(body).tx_response));
      if (!isNotFound(status, body) && status !== 400) throw new Error(`tx ${hash}: HTTP ${status}`);
      if (now() >= deadline) throw new Error(`tx ${hash} not in a block after ${opts.waitMs} ms`);
      await sleep(opts.pollMs);
    }
  };

  return {
    async account(address) {
      const { status, body } = await getJson(f, `${base}/cosmos/auth/v1beta1/accounts/${address}`);
      if (status === 200) return parseAccount(body);
      if (isNotFound(status, body)) return undefined;
      throw new Error(`account ${address}: HTTP ${status}`);
    },

    async balance(address) {
      const url = `${base}/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${encodeURIComponent(opts.denom)}`;
      const { status, body } = await getJson(f, url);
      if (status !== 200) throw new Error(`balance ${address}: HTTP ${status}`);
      const amount = obj(obj(body).balance).amount;
      return typeof amount === "string" ? BigInt(amount) : 0n;
    },

    pqcStatus(address) {
      return fetchPqcStatus({ rest: base, address, fetch: f as never });
    },

    window(address) {
      return fetchEvmWindow({ rest: base, address, fetch: windowFetch as never });
    },

    submit,

    async broadcast(txBytes) {
      const r = await submit(txBytes);
      if (r.stage === "check") throw new Error(`broadcast refused ${r.hash}: code ${r.code} ${r.log}`);
      if (r.code !== 0) throw new Error(`tx ${r.hash} failed: code ${r.code} ${r.log}`);
      return { hash: r.hash, height: r.height!, gasUsed: r.gasUsed! };
    },
  };
}

function submitted(hash: string, stage: Submitted["stage"], r: Record<string, unknown>): Submitted {
  const num = (x: unknown) => (x === undefined || x === null || x === "" ? null : Number(x));
  const events = Array.isArray(r.events) ? (r.events as Submitted["events"]) : [];
  return {
    hash,
    stage,
    code: Number(r.code ?? 0),
    codespace: typeof r.codespace === "string" ? r.codespace : "",
    log: String(r.raw_log ?? ""),
    height: stage === "block" ? num(r.height) : null,
    gasUsed: num(r.gas_used),
    events: events.map((e) => ({
      type: String(e.type),
      attributes: (e.attributes ?? []).map((a) => ({ key: String(a.key), value: String(a.value) })),
    })),
  };
}
