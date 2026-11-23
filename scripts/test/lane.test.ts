import { describe, expect, it } from "vitest";
import { parseAccount, restLane, type Fetch } from "../src/lane.js";

const REST = "https://rest.example";
const ADDR = "qor1fixtureaccount";

type Reply = { status: number; body: unknown };

/** A fetch that answers by URL from a table; each entry may be a list, consumed in order. */
function fakeFetch(table: Record<string, Reply | Reply[]>, seen: { url: string; body?: string | undefined }[] = []): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: init?.body as string | undefined });
    const entry = table[url];
    if (!entry) throw new Error(`unexpected fetch ${url}`);
    const reply = Array.isArray(entry) ? entry.shift()! : entry;
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as Fetch;
}

function lane(f: Fetch, waitMs = 1_000) {
  let t = 0;
  return restLane({
    rest: `${REST}/`,
    denom: "uqor",
    waitMs,
    pollMs: 100,
    fetch: f,
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  });
}

const notFound = { status: 404, body: { code: 5, message: "tx not found: X", details: [] } };

describe("parseAccount", () => {
  it("reads a plain BaseAccount and one wrapped as base_account", () => {
    expect(parseAccount({ account: { account_number: "12", sequence: "3" } })).toEqual({ accountNumber: 12n, sequence: 3n });
    expect(parseAccount({ account: { base_account: { account_number: "7", sequence: "0" } } })).toEqual({
      accountNumber: 7n,
      sequence: 0n,
    });
  });

  it("refuses an answer with no account number", () => {
    expect(() => parseAccount({ account: {} })).toThrow(/account_number/);
  });
});

describe("restLane reads", () => {
  it("answers undefined for an account the chain has never seen", async () => {
    const f = fakeFetch({
      [`${REST}/cosmos/auth/v1beta1/accounts/${ADDR}`]: { status: 404, body: { code: 5, message: "not found" } },
    });
    expect(await lane(f).account(ADDR)).toBeUndefined();
  });

  it("throws on other account errors instead of treating them as no account", async () => {
    const f = fakeFetch({ [`${REST}/cosmos/auth/v1beta1/accounts/${ADDR}`]: { status: 500, body: { code: 2 } } });
    await expect(lane(f).account(ADDR)).rejects.toThrow(/HTTP 500/);
  });

  it("reads the balance of the configured denom", async () => {
    const f = fakeFetch({
      [`${REST}/cosmos/bank/v1beta1/balances/${ADDR}/by_denom?denom=uqor`]: {
        status: 200,
        body: { balance: { denom: "uqor", amount: "60000000" } },
      },
    });
    expect(await lane(f).balance(ADDR)).toBe(60_000_000n);
  });
});

describe("restLane broadcast", () => {
  const POST = `${REST}/cosmos/tx/v1beta1/txs`;
  const HASH = "AB".repeat(32);
  const GET = `${POST}/${HASH}`;
  const accepted = { status: 200, body: { tx_response: { code: 0, txhash: HASH } } };

  it("posts the bytes in sync mode and waits until the tx is in a block", async () => {
    const seen: { url: string; body?: string | undefined }[] = [];
    const f = fakeFetch(
      {
        [POST]: accepted,
        [GET]: [notFound, notFound, { status: 200, body: { tx_response: { code: 0, height: "42", gas_used: "191540" } } }],
      },
      seen,
    );
    const inc = await lane(f).broadcast(new Uint8Array([1, 2, 3]));
    expect(inc).toEqual({ hash: HASH, height: 42, gasUsed: 191540 });
    expect(JSON.parse(seen[0]!.body!)).toEqual({ tx_bytes: "AQID", mode: "BROADCAST_MODE_SYNC" });
    expect(seen.filter((s) => s.url === GET)).toHaveLength(3);
  });

  it("throws when CheckTx refuses the tx", async () => {
    const f = fakeFetch({ [POST]: { status: 200, body: { tx_response: { code: 21, txhash: HASH, raw_log: "pqc" } } } });
    await expect(lane(f).broadcast(new Uint8Array([1]))).rejects.toThrow(/refused .*code 21 pqc/);
  });

  it("throws when the tx fails in the block", async () => {
    const f = fakeFetch({
      [POST]: accepted,
      [GET]: { status: 200, body: { tx_response: { code: 11, height: "9", raw_log: "out of gas" } } },
    });
    await expect(lane(f).broadcast(new Uint8Array([1]))).rejects.toThrow(/failed: code 11 out of gas/);
  });

  it("submit reports a CheckTx refusal instead of throwing", async () => {
    const f = fakeFetch({ [POST]: { status: 200, body: { tx_response: { code: 4, txhash: HASH, codespace: "sdk", raw_log: "no window" } } } });
    expect(await lane(f).submit(new Uint8Array([1]))).toMatchObject({
      hash: HASH,
      stage: "check",
      code: 4,
      codespace: "sdk",
      log: "no window",
      height: null,
    });
  });

  it("submit reports a failure in the block with its height, gas and events", async () => {
    const events = [{ type: "message", attributes: [{ key: "action", value: "/qorechain.crossvm.v1.MsgCrossVMCall" }] }];
    const body = { tx_response: { code: 7, codespace: "crossvm", height: "12", gas_used: "900", raw_log: "refused", events } };
    const f = fakeFetch({ [POST]: accepted, [GET]: { status: 200, body } });
    expect(await lane(f).submit(new Uint8Array([1]))).toEqual({
      hash: HASH,
      stage: "block",
      code: 7,
      codespace: "crossvm",
      log: "refused",
      height: 12,
      gasUsed: 900,
      events,
    });
  });

  it("gives up after the wait time", async () => {
    const f = fakeFetch({ [POST]: accepted, [GET]: Array.from({ length: 20 }, () => notFound) });
    await expect(lane(f, 500).broadcast(new Uint8Array([1]))).rejects.toThrow(/not in a block after 500 ms/);
  });
});
