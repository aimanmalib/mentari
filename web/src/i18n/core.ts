import en from "../../locales/en.json";
import ms from "../../locales/ms.json";

export type Messages = typeof en;
export const catalogues: Record<string, Messages> = { en, ms };

/** BCP 47 tags used for number and date formatting. */
export const formatTags: Record<string, string> = { en: "en-GB", ms: "ms-MY" };

export type Vars = Record<string, string | number>;

/** Looks up a dotted key; a missing key shows the key itself so it is easy to spot, never an empty string. */
export function translate(messages: Messages, key: string, vars: Vars = {}): string {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    node = typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  }
  if (typeof node !== "string") return key;
  return node.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Order: `?lang=` in the URL, then the saved choice, then the browser language, then the default. */
export function pickLocale(
  available: readonly string[],
  fallback: string,
  sources: { query?: string | null; saved?: string | null; browser?: readonly string[] },
): string {
  const ok = (v: string | null | undefined) => (v && available.includes(v) ? v : null);
  const fromBrowser = (sources.browser ?? []).map((l) => l.toLowerCase().split("-")[0]).find((l) => ok(l));
  return ok(sources.query) ?? ok(sources.saved) ?? fromBrowser ?? fallback;
}
