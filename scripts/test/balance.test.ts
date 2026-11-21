import { describe, expect, it } from "vitest";
import { evmBalance, formatAmount } from "../src/balance.js";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("evmBalance", () => {
  it("parses the hex result", async () => {
    const v = await evmBalance("http://rpc", "0x0", fakeFetch({ result: "0x1bc16d674ec80000" }));
    expect(v).toBe(2_000_000_000_000_000_000n);
    expect(formatAmount(v, 18, "QOR")).toBe("2 QOR");
  });
  it("surfaces RPC and HTTP errors", async () => {
    await expect(evmBalance("http://rpc", "0x0", fakeFetch({ error: { message: "bad" } }))).rejects.toThrow(/bad/);
    await expect(evmBalance("http://rpc", "0x0", fakeFetch({}, 502))).rejects.toThrow(/502/);
  });
});
