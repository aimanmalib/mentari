import { describe, expect, it } from "vitest";
import { checkPair, latestNumbers, notePrefix, summarise } from "../src/data/agree.js";
import type { Receipt, Retirement } from "../src/data/types.js";

const NATIVE = "qor1tcdqqqqqqqqqqqqqqqqqqqqqqqqqpsx755prn6";
const r: Retirement = { n: 7, holder: "0x7D3C000000000000000000000000000000000007", wh: 500n, receiptId: 42, timestamp: 1 };
const good: Receipt = {
  id: 42,
  sender: NATIVE,
  note: "MTR1 n=7 wh=500 by=0x7d3c000000000000000000000000000000000007 m=demo",
  height: 1,
};

describe("notePrefix", () => {
  it("matches the note format the contract writes, with the holder in lowercase", () => {
    expect(notePrefix(r)).toBe("MTR1 n=7 wh=500 by=0x7d3c000000000000000000000000000000000007 m=");
  });
});

describe("checkPair", () => {
  it("accepts a receipt from the contract with the matching note", () => {
    expect(checkPair(r, good, NATIVE)).toEqual({ n: 7, receiptId: 42, ok: true, problems: [] });
  });

  it("flags a missing receipt", () => {
    expect(checkPair(r, null, NATIVE).problems).toEqual(["missing-receipt"]);
  });

  it("flags a receipt whose id is not the one the retirement points to", () => {
    expect(checkPair(r, { ...good, id: 41 }, NATIVE).problems).toEqual(["missing-receipt"]);
  });

  it("flags a receipt written by another sender", () => {
    expect(checkPair(r, { ...good, sender: "qor1someoneelse" }, NATIVE).problems).toEqual(["wrong-sender"]);
  });

  it.each([
    ["another amount", good.note.replace("wh=500", "wh=501")],
    ["another number", good.note.replace("n=7", "n=8")],
    ["another holder", good.note.replace("0x7d3c", "0x7d3d")],
    ["a longer number that only starts the same", good.note.replace("n=7", "n=70")],
    ["a note without the memo field", "MTR1 n=7 wh=500 by=0x7d3c000000000000000000000000000000000007"],
  ])("flags a note with %s", (_label, note) => {
    expect(checkPair(r, { ...good, note }, NATIVE).problems).toEqual(["wrong-note"]);
  });

  it("reports every problem at once", () => {
    expect(checkPair(r, { ...good, sender: "x", note: "y" }, NATIVE).problems).toEqual(["wrong-sender", "wrong-note"]);
  });
});

describe("summarise", () => {
  const ok = checkPair(r, good, NATIVE);
  const bad = checkPair({ ...r, n: 6 }, null, NATIVE);

  it("is empty when there are no retirements", () => {
    expect(summarise([], 0)).toEqual({ state: "empty" });
  });

  it("agrees only when every checked pair matches", () => {
    expect(summarise([ok], 1)).toEqual({ state: "agree", checked: 1, total: 1 });
    expect(summarise([ok, bad], 2)).toEqual({ state: "disagree", checked: 2, total: 2, failed: [bad] });
  });

  it("does not claim agreement when retirements exist but none was checked", () => {
    expect(summarise([], 3).state).toBe("disagree");
  });
});

describe("latestNumbers", () => {
  it("lists the newest first and stops at the limit", () => {
    expect(latestNumbers(12, 3)).toEqual([12, 11, 10]);
    expect(latestNumbers(2, 10)).toEqual([2, 1]);
    expect(latestNumbers(0, 10)).toEqual([]);
  });
});
