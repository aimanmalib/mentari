// Checks the transaction links read from a page of the live site (decisions 0033, 0034). Pure, so vitest runs it;
// web/og/check-links.ts feeds it the links a real browser sees.

export interface LinkPage {
  path: string;
  ready: string;
}

/** The explorer URL shapes in config/app.json web.explorer that matter here. */
export interface LinkTemplates {
  tx: string;
  evmTx: string;
  receiptTx: string;
}

export type LinkKind = "explorer-tx" | "go-tx" | "go-receipt" | "other";

export interface LinkProblem {
  href: string;
  problem: "evm-hash-on-explorer" | "not-a-cosmos-hash" | "bad-go-link";
}

const COSMOS_HASH = /^[0-9A-F]{64}$/;
const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;

/** The part of a template before its `{name}` placeholder: the prefix every link of that kind starts with. */
const prefixOf = (template: string) => template.slice(0, template.indexOf("{"));

/** Checks each entry of web.linkCheck.pages and returns it typed; throws with the entry index on the first problem. */
export function linkPages(list: unknown): LinkPage[] {
  if (!Array.isArray(list) || list.length === 0) throw new Error("web.linkCheck.pages: expected a non-empty array");
  return list.map((raw, i) => {
    const at = `web.linkCheck.pages[${i}]`;
    if (typeof raw !== "object" || raw === null) throw new Error(`${at}: expected an object`);
    const e = raw as Record<string, unknown>;
    for (const k of ["path", "ready"] as const) {
      if (typeof e[k] !== "string" || e[k] === "") throw new Error(`${at}.${k}: expected a non-empty string`);
    }
    if (!(e.path as string).startsWith("/")) throw new Error(`${at}.path: must start with /`);
    return { path: e.path as string, ready: e.ready as string };
  });
}

/** Sorts one href into the link kinds the site makes and reports what is wrong with it, if anything. */
export function checkLink(href: string, t: LinkTemplates): { kind: LinkKind; problem?: LinkProblem["problem"] } {
  const explorerTx = prefixOf(t.tx);
  const goTx = prefixOf(t.evmTx);
  const goReceipt = prefixOf(t.receiptTx);
  if (href.startsWith(explorerTx)) {
    const hash = decodeURIComponent(href.slice(explorerTx.length));
    if (/^0x/i.test(hash)) return { kind: "explorer-tx", problem: "evm-hash-on-explorer" };
    return COSMOS_HASH.test(hash) ? { kind: "explorer-tx" } : { kind: "explorer-tx", problem: "not-a-cosmos-hash" };
  }
  if (href.startsWith(goTx)) {
    const hash = decodeURIComponent(href.slice(goTx.length));
    return EVM_HASH.test(hash) || COSMOS_HASH.test(hash) ? { kind: "go-tx" } : { kind: "go-tx", problem: "bad-go-link" };
  }
  if (href.startsWith(goReceipt)) {
    return /^[0-9]+$/.test(href.slice(goReceipt.length)) ? { kind: "go-receipt" } : { kind: "go-receipt", problem: "bad-go-link" };
  }
  return { kind: "other" };
}

/** Where a `/go/` redirect must land: the explorer page of one Cosmos hash. */
export function isExplorerTx(location: string | null, t: LinkTemplates): boolean {
  if (!location) return false;
  const prefix = prefixOf(t.tx);
  return location.startsWith(prefix) && COSMOS_HASH.test(location.slice(prefix.length));
}
