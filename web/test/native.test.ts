import { describe, expect, it } from "vitest";
import { ReceiptsBook, queryPath, type Fetch } from "../src/data/native.js";

const BOOK = "qor1book";

/** A fetch that answers from a table of path → [status, body]; unknown paths fail like a dead network. */
function fakeFetch(answers: Record<string, [number, unknown]>, seen: string[] = []): Fetch {
  return async (url) => {
    seen.push(url);
    const hit = answers[url];
    if (!hit) throw new TypeError("network down");
    const [status, body] = hit;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

describe("queryPath", () => {
  it("base64-encodes the JSON query under the read-only proxy", () => {
    // Same bytes as `printf '{"count":{}}' | base64`.
    expect(queryPath("/lcd", BOOK, { count: {} })).toBe(`/lcd/cosmwasm/wasm/v1/contract/${BOOK}/smart/eyJjb3VudCI6e319`);
  });

  it("escapes base64 characters that are not safe in a path", () => {
    const path = queryPath("/lcd", BOOK, { receipt: { id: 1023 } });
    expect(path).not.toMatch(/smart\/.*[+/=]/);
  });
});

describe("ReceiptsBook", () => {
  const receipt = { id: 3, sender: "qor1x", note: "n", height: 9 };

  it("reads the count", async () => {
    const book = new ReceiptsBook("/lcd", BOOK, fakeFetch({ [queryPath("/lcd", BOOK, { count: {} })]: [200, { data: { count: 3 } }] }));
    expect(await book.count()).toBe(3);
  });

  it("returns a receipt", async () => {
    const path = queryPath("/lcd", BOOK, { receipt: { id: 3 } });
    const book = new ReceiptsBook("/lcd", BOOK, fakeFetch({ [path]: [200, { data: receipt }] }));
    expect(await book.receipt(3)).toEqual(receipt);
  });

  it("returns null when the chain says the receipt is not found", async () => {
    const path = queryPath("/lcd", BOOK, { receipt: { id: 999 } });
    const body = { code: 2, message: "type: qday_receipts::Receipt; key: [..] not found: query wasm contract failed" };
    const book = new ReceiptsBook("/lcd", BOOK, fakeFetch({ [path]: [500, body] }));
    expect(await book.receipt(999)).toBeNull();
  });

  it("throws on other failures, so the page says it could not check instead of saying a receipt is missing", async () => {
    const path = queryPath("/lcd", BOOK, { receipt: { id: 4 } });
    const book = new ReceiptsBook("/lcd", BOOK, fakeFetch({ [path]: [502, { message: "bad gateway" }] }));
    await expect(book.receipt(4)).rejects.toThrow(/unavailable/);
    await expect(new ReceiptsBook("/lcd", BOOK, fakeFetch({})).receipt(4)).rejects.toThrow();
  });

  it("treats a malformed receipt as missing", async () => {
    const path = queryPath("/lcd", BOOK, { receipt: { id: 3 } });
    const book = new ReceiptsBook("/lcd", BOOK, fakeFetch({ [path]: [200, { data: { id: "3" } }] }));
    expect(await book.receipt(3)).toBeNull();
  });
});
