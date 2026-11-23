import { escapeHtml, type WebConfig } from "../share-meta.js";
import { fillSlots, fontFaces, inlineLogo, type CardFont } from "./card.js";

/** `config/app.json` `web.cover`: the submission cover image and the live page shot inside it. */
export interface CoverConfig {
  image: string;
  width: number;
  height: number;
  maxKb: number;
  shotPath: string;
  shotReadySelector: string;
  shotWidth: number;
  shotHeight: number;
}

export interface CoverInput {
  template: string;
  web: WebConfig;
  cover: CoverConfig;
  catalogues: Record<string, unknown>;
  tokensCss: string;
  logoSvg: string;
  fonts: readonly CardFont[];
  shotPng: Buffer;
}

const COVER_KEYS = ["kicker", "tagline", "shotAlt"] as const;
type CoverText = Record<(typeof COVER_KEYS)[number], string>;

/** Reads `cover.kicker`, `cover.tagline` and `cover.shotAlt` from one catalogue; a missing one stops the render. */
export function coverText(messages: unknown, locale: string): CoverText {
  const cover = (messages as { cover?: Record<string, unknown> } | undefined)?.cover ?? {};
  const out = {} as CoverText;
  for (const key of COVER_KEYS) {
    const value = cover[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`cover image: web/locales/${locale}.json has no cover.${key}`);
    }
    out[key] = value;
  }
  return out;
}

/** Fills every `{{slot}}` of `web/og/cover.html`, with the page shot embedded as a data URL. */
export function coverHtml(input: CoverInput): string {
  const share = input.web.share;
  if (!share) throw new Error("cover image: config/app.json has no web.share block");
  const locale = input.web.defaultLocale;
  const text = coverText(input.catalogues[locale], locale);
  const { cover } = input;
  return fillSlots(input.template, {
    lang: escapeHtml(locale),
    fonts: fontFaces(input.fonts),
    tokens: input.tokensCss,
    width: String(cover.width),
    height: String(cover.height),
    logo: inlineLogo(input.logoSvg),
    siteName: escapeHtml(share.siteName),
    host: escapeHtml(new URL(share.siteUrl).host),
    kicker: escapeHtml(text.kicker),
    tagline: escapeHtml(text.tagline),
    shotAlt: escapeHtml(text.shotAlt),
    shot: `data:image/png;base64,${input.shotPng.toString("base64")}`,
    shotRatio: `${cover.shotWidth} / ${cover.shotHeight}`,
  }, "cover image: cover.html");
}
