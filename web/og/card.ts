import { escapeHtml, metaText, type WebConfig } from "../share-meta.js";

/** One font file, embedded as a data URL so the capture needs no file or network access. */
export interface CardFont {
  family: string;
  woff2: Buffer;
  weight: string;
  stretch?: string;
}

export interface CardInput {
  template: string;
  web: WebConfig;
  catalogues: Record<string, unknown>;
  tokensCss: string;
  logoSvg: string;
  fonts: readonly CardFont[];
}

export function fontFaces(fonts: readonly CardFont[]): string {
  return fonts
    .map((f) => {
      const stretch = f.stretch ? ` font-stretch: ${f.stretch};` : "";
      const src = `url("data:font/woff2;base64,${f.woff2.toString("base64")}") format("woff2")`;
      return `@font-face { font-family: "${f.family}"; src: ${src}; font-weight: ${f.weight};${stretch} font-display: block; }`;
    })
    .join("\n");
}

/** Fills every `{{slot}}` of `web/og/card.html`; an unknown or unfilled slot stops the render. */
export function cardHtml(input: CardInput): string {
  const share = input.web.share;
  if (!share) throw new Error("preview card: config/app.json has no web.share block");
  const locale = input.web.defaultLocale;
  const text = metaText(input.catalogues[locale], locale);
  const slots: Record<string, string> = {
    lang: escapeHtml(locale),
    fonts: fontFaces(input.fonts),
    tokens: input.tokensCss,
    width: String(share.imageWidth),
    height: String(share.imageHeight),
    logo: input.logoSvg.replace(/<title>[^<]*<\/title>/, "").replace("<svg ", '<svg aria-hidden="true" '),
    siteName: escapeHtml(share.siteName),
    host: escapeHtml(new URL(share.siteUrl).host),
    title: escapeHtml(text.title),
    description: escapeHtml(text.description),
  };
  return input.template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = slots[key];
    if (value === undefined) throw new Error(`preview card: card.html has an unknown slot {{${key}}}`);
    return value;
  });
}

/** The Apple touch icon: the brand mark without its rounded corners, since iOS rounds the icon itself. */
export function touchIconHtml(logoSvg: string, size: number): string {
  const svg = logoSvg
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/ rx="[^"]*"/, "")
    .replace(/ width="[^"]*" height="[^"]*"/, ` width="${size}" height="${size}"`);
  return `<!doctype html><html><head><style>html,body{margin:0}svg{display:block}</style></head><body>${svg}</body></html>`;
}
