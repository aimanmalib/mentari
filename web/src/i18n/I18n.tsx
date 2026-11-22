import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { siteConfig } from "../config.js";
import { catalogues, formatTags, pickLocale, translate, type Vars } from "./core.js";

const STORAGE_KEY = "mentari.lang";

interface I18nValue {
  locale: string;
  setLocale(locale: string): void;
  t(key: string, vars?: Vars): string;
  num(value: bigint | number): string;
  dateTime(ms: number): string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode); the URL and browser language still work.
  }
  return pickLocale(siteConfig.locales, siteConfig.defaultLocale, {
    query: new URLSearchParams(location.search).get("lang"),
    saved,
    browser: navigator.languages,
  });
}

/** `locale` fixes the starting language (tests, server rendering); otherwise it comes from the URL, storage or browser. */
export function I18nProvider({ children, locale: fixed }: { children: ReactNode; locale?: string }) {
  const [locale, setLocaleState] = useState(() => fixed ?? initialLocale());
  const messages = catalogues[locale] ?? catalogues[siteConfig.defaultLocale]!;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(messages, "meta.title");
    document.querySelector('meta[name="description"]')?.setAttribute("content", translate(messages, "meta.description"));
  }, [locale, messages]);

  const setLocale = useCallback((next: string) => {
    if (!siteConfig.locales.includes(next)) return;
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // See initialLocale.
    }
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", next);
      history.replaceState(history.state, "", url);
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const tag = formatTags[locale] ?? locale;
    const numbers = new Intl.NumberFormat(tag);
    const dates = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" });
    return {
      locale,
      setLocale,
      t: (key, vars) => translate(messages, key, vars),
      num: (v) => numbers.format(v),
      dateTime: (ms) => dates.format(ms),
    };
  }, [locale, messages, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n outside I18nProvider");
  return value;
}
