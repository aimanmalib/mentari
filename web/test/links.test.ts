import { describe, expect, it } from "vitest";
import app from "../../config/app.json" with { type: "json" };
import { checkLink, isExplorerTx, linkPages } from "../og/links.js";

// A frozen copy of the URL shapes, so the test does not follow later config edits.
const T = {
  tx: "https://explore.example/tx/{hash}",
  evmTx: "/go/tx/{hash}",
  receiptTx: "/go/receipt/{id}",
};
const COSMOS = "AB".repeat(32);
const EVM = `0x${"cd".repeat(32)}`;

describe("web.linkCheck", () => {
  it("accepts the pages in config/app.json", () => {
    expect(linkPages(app.web.linkCheck.pages).length).toBe(app.web.linkCheck.pages.length);
  });

  it("refuses a page without a ready selector or a leading slash", () => {
    expect(() => linkPages([])).toThrow("non-empty array");
    expect(() => linkPages([{ path: "/", ready: "" }])).toThrow("pages[0].ready");
    expect(() => linkPages([{ path: "try", ready: "main" }])).toThrow("must start with /");
  });
});

describe("checkLink", () => {
  it("passes a Cosmos hash on the explorer and both /go/ routes", () => {
    expect(checkLink(`https://explore.example/tx/${COSMOS}`, T)).toEqual({ kind: "explorer-tx" });
    expect(checkLink(`/go/tx/${EVM}`, T)).toEqual({ kind: "go-tx" });
    expect(checkLink(`/go/tx/${COSMOS}`, T)).toEqual({ kind: "go-tx" });
    expect(checkLink("/go/receipt/42", T)).toEqual({ kind: "go-receipt" });
    expect(checkLink("/verify?n=1", T)).toEqual({ kind: "other" });
  });

  it("flags an EVM hash sent straight to the explorer, which shows Transaction not found", () => {
    expect(checkLink(`https://explore.example/tx/${EVM}`, T).problem).toBe("evm-hash-on-explorer");
  });

  it("flags a lower case or short hash on the explorer and a broken /go/ link", () => {
    expect(checkLink(`https://explore.example/tx/${COSMOS.toLowerCase()}`, T).problem).toBe("not-a-cosmos-hash");
    expect(checkLink("https://explore.example/tx/ABCD", T).problem).toBe("not-a-cosmos-hash");
    expect(checkLink("/go/tx/undefined", T).problem).toBe("bad-go-link");
    expect(checkLink("/go/receipt/", T).problem).toBe("bad-go-link");
  });
});

describe("isExplorerTx", () => {
  it("wants a redirect to the explorer page of one Cosmos hash", () => {
    expect(isExplorerTx(`https://explore.example/tx/${COSMOS}`, T)).toBe(true);
    expect(isExplorerTx(`https://explore.example/tx/${EVM}`, T)).toBe(false);
    expect(isExplorerTx("/", T)).toBe(false);
    expect(isExplorerTx(null, T)).toBe(false);
  });
});
