import type { Plugin } from "vite";

/** `config/app.json` `web.share`: every value of the link preview lives there, none in this file. */
export interface ShareConfig {
  siteUrl: string;
  siteName: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  imageMaxKb: number;
  twitterCard: string;
  appleTouchIcon: string;
  ogLocales: Record<string, string>;
}

export interface WebConfig {
  defaultLocale: string;
  locales: readonly string[];
  share?: ShareConfig;
}

export interface HeadTag {
  tag: "title" | "meta" | "link";
  attrs: Record<string, string>;
  text?: string;
}

const META_KEYS = ["title", "description", "imageAlt"] as const;
type MetaText = Record<(typeof META_KEYS)[number], string>;

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Reads `meta.title`, `meta.description` and `meta.imageAlt` from one catalogue; a missing one stops the build. */
export function metaText(messages: unknown, locale: string): MetaText {
  const meta = (messages as { meta?: Record<string, unknown> } | undefined)?.meta ?? {};
  const out = {} as MetaText;
  for (const key of META_KEYS) {
    const value = meta[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`share preview: web/locales/${locale}.json has no meta.${key}`);
    }
    out[key] = value;
  }
  return out;
}

function shareConfig(web: WebConfig): ShareConfig {
  const share = web.share;
  if (!share) throw new Error("share preview: config/app.json has no web.share block");
  if (!/^https:\/\/[^/]+/.test(share.siteUrl) || share.siteUrl.endsWith("/")) {
    throw new Error("share preview: web.share.siteUrl must be an https address without a trailing slash");
  }
  for (const key of ["image", "appleTouchIcon"] as const) {
    if (!share[key].startsWith("/")) throw new Error(`share preview: web.share.${key} must start with /`);
  }
  return share;
}

/** Every head tag of the link preview, in the default locale. Pure: config and catalogues in, tags out. */
export function shareTags(web: WebConfig, catalogues: Record<string, unknown>): HeadTag[] {
  const share = shareConfig(web);
  const locale = web.defaultLocale;
  const text = metaText(catalogues[locale], locale);
  const pageUrl = `${share.siteUrl}/`;
  const imageUrl = `${share.siteUrl}${share.image}`;
  const ext = share.image.split(".").pop()?.toLowerCase() ?? "";
  const imageType = IMAGE_TYPES[ext];
  if (!imageType) throw new Error(`share preview: web.share.image must be a PNG or JPEG, not .${ext}`);
  const ogLocale = (code: string) => {
    const tag = share.ogLocales[code];
    if (!tag) throw new Error(`share preview: web.share.ogLocales has no entry for ${code}`);
    return tag;
  };
  const prop = (property: string, content: string): HeadTag => ({ tag: "meta", attrs: { property, content } });
  const name = (n: string, content: string): HeadTag => ({ tag: "meta", attrs: { name: n, content } });
  return [
    { tag: "title", attrs: {}, text: text.title },
    name("description", text.description),
    { tag: "link", attrs: { rel: "canonical", href: pageUrl } },
    prop("og:type", "website"),
    prop("og:site_name", share.siteName),
    prop("og:url", pageUrl),
    prop("og:title", text.title),
    prop("og:description", text.description),
    prop("og:image", imageUrl),
    prop("og:image:type", imageType),
    prop("og:image:width", String(share.imageWidth)),
    prop("og:image:height", String(share.imageHeight)),
    prop("og:image:alt", text.imageAlt),
    prop("og:locale", ogLocale(locale)),
    ...web.locales.filter((l) => l !== locale).map((l) => prop("og:locale:alternate", ogLocale(l))),
    name("twitter:card", share.twitterCard),
    name("twitter:title", text.title),
    name("twitter:description", text.description),
    name("twitter:image", imageUrl),
    name("twitter:image:alt", text.imageAlt),
    { tag: "link", attrs: { rel: "apple-touch-icon", href: share.appleTouchIcon } },
  ];
}

export function renderTag({ tag, attrs, text }: HeadTag): string {
  const attrText = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join("");
  return tag === "title" ? `<title>${escapeHtml(text ?? "")}</title>` : `<${tag}${attrText} />`;
}

/** Puts the tags before `</head>`. The page source must not carry its own title or description. */
export function applyShareTags(html: string, tags: readonly HeadTag[]): string {
  if (/<title[\s>]|<meta\s+name="description"/i.test(html)) {
    throw new Error("share preview: index.html sets its own title or description; they come from the locale files");
  }
  const at = html.search(/<\/head>/i);
  if (at < 0) throw new Error("share preview: index.html has no </head>");
  const block = tags.map((t) => `    ${renderTag(t)}\n`).join("");
  return `${html.slice(0, at).trimEnd()}\n${block}  ${html.slice(at)}`;
}

/** Vite plugin: the same tags in `vite dev`, `vite build` and the e2e build. */
export function shareMeta(web: WebConfig, catalogues: Record<string, unknown>): Plugin {
  const tags = shareTags(web, catalogues);
  return {
    name: "mentari-share-meta",
    transformIndexHtml: { order: "pre", handler: (html) => applyShareTags(html, tags) },
  };
}
