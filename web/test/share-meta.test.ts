import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyShareTags, escapeHtml, renderTag, shareTags, type WebConfig } from "../share-meta.js";
import app from "../../config/app.json" with { type: "json" };
import en from "../locales/en.json" with { type: "json" };
import ms from "../locales/ms.json" with { type: "json" };

// A frozen fixture: the tests check the shape of the tags, not the owner's live wording or address.
const web: WebConfig = {
  defaultLocale: "en",
  locales: ["en", "ms"],
  share: {
    siteUrl: "https://example.test",
    siteName: "Site",
    image: "/card.png",
    imageWidth: 1200,
    imageHeight: 630,
    imageMaxKb: 300,
    twitterCard: "card-kind",
    appleTouchIcon: "/touch.png",
    appleTouchIconSize: 99,
    ogLocales: { en: "en_XX", ms: "ms_XX" },
  },
};
const catalogues = {
  en: { meta: { title: "T", description: "D", imageAlt: "A" } },
  ms: { meta: { title: "T2", description: "D2", imageAlt: "A2" } },
};

const content = (tags: ReturnType<typeof shareTags>, key: string) =>
  tags.filter((t) => t.attrs.property === key || t.attrs.name === key).map((t) => t.attrs.content);

describe("shareTags", () => {
  const tags = shareTags(web, catalogues);

  it("covers Open Graph, the large X card, canonical and the touch icon", () => {
    for (const key of ["og:type", "og:site_name", "og:url", "og:title", "og:description", "og:image", "og:image:type",
      "og:image:width", "og:image:height", "og:image:alt", "og:locale", "og:locale:alternate", "twitter:card",
      "twitter:title", "twitter:description", "twitter:image", "twitter:image:alt", "description"]) {
      expect(content(tags, key), key).toHaveLength(1);
    }
    expect(tags.find((t) => t.tag === "title")?.text).toBe("T");
    expect(tags.find((t) => t.attrs.rel === "canonical")?.attrs.href).toBe("https://example.test/");
    expect(tags.find((t) => t.attrs.rel === "apple-touch-icon")?.attrs).toEqual({
      rel: "apple-touch-icon",
      sizes: "99x99",
      href: "/touch.png",
    });
  });

  it("takes every value from config and the default locale", () => {
    expect(content(tags, "og:image")).toEqual(["https://example.test/card.png"]);
    expect(content(tags, "twitter:image")).toEqual(["https://example.test/card.png"]);
    expect(content(tags, "og:image:type")).toEqual(["image/png"]);
    expect(content(tags, "og:image:width")).toEqual(["1200"]);
    expect(content(tags, "twitter:card")).toEqual(["card-kind"]);
    expect(content(tags, "og:locale")).toEqual(["en_XX"]);
    expect(content(tags, "og:locale:alternate")).toEqual(["ms_XX"]);
    expect(content(tags, "og:description")).toEqual(["D"]);
    expect(content(tags, "og:image:alt")).toEqual(["A"]);
    const msFirst = shareTags({ ...web, defaultLocale: "ms" }, catalogues);
    expect(content(msFirst, "og:title")).toEqual(["T2"]);
    expect(content(msFirst, "og:locale:alternate")).toEqual(["en_XX"]);
  });

  it("names a JPEG image as image/jpeg", () => {
    const jpg = shareTags({ ...web, share: { ...web.share!, image: "/card.jpg" } }, catalogues);
    expect(content(jpg, "og:image:type")).toEqual(["image/jpeg"]);
  });

  it("stops the build when web.share or a locale key is missing", () => {
    expect(() => shareTags({ defaultLocale: "en", locales: ["en"] }, catalogues)).toThrow(/web\.share/);
    expect(() => shareTags(web, { en: { meta: { title: "T", description: "D" } } })).toThrow(/en\.json has no meta\.imageAlt/);
    expect(() => shareTags({ ...web, share: { ...web.share!, siteUrl: "http://example.test" } }, catalogues)).toThrow(/https/);
    expect(() => shareTags({ ...web, share: { ...web.share!, image: "/card.webp" } }, catalogues)).toThrow(/PNG or JPEG/);
    expect(() => shareTags({ ...web, share: { ...web.share!, ogLocales: { en: "en_XX" } } }, catalogues)).toThrow(/ms/);
  });
});

describe("rendering", () => {
  it("escapes & < > and double quotes", () => {
    expect(escapeHtml(`a & <b> "c"`)).toBe("a &amp; &lt;b&gt; &quot;c&quot;");
    const tags = shareTags(web, { en: { meta: { title: `<x>&"`, description: `"q"`, imageAlt: "a<b" } } });
    const html = tags.map(renderTag).join("\n");
    expect(html).toContain("<title>&lt;x&gt;&amp;&quot;</title>");
    expect(html).toContain('property="og:description" content="&quot;q&quot;"');
    expect(html).not.toMatch(/content="[^"]*<[^"]*"/);
  });

  it("puts the tags inside head and refuses a page that sets its own title", () => {
    const out = applyShareTags("<html><head>\n  </head><body><p>x</p></body></html>", shareTags(web, catalogues));
    expect(out.indexOf('property="og:image"')).toBeLessThan(out.indexOf("</head>"));
    expect(out).toContain("<body><p>x</p></body>");
    expect(() => applyShareTags("<head><title>x</title></head>", [])).toThrow(/title/);
    expect(() => applyShareTags("<body></body>", [])).toThrow(/head/);
  });
});

describe("the real config and locale files", () => {
  it("give a complete preview in every locale, with an absolute https image", () => {
    const real = app.web as WebConfig;
    for (const locale of real.locales) {
      const tags = shareTags({ ...real, defaultLocale: locale }, { en, ms });
      expect(content(tags, "og:image")[0]).toMatch(/^https:\/\/[^/]+\/.+\.(png|jpe?g)$/);
      expect(content(tags, "og:image:alt")[0]).toBeTruthy();
    }
  });

  it("index.html leaves title, description and preview tags to the build", () => {
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    expect(html).not.toMatch(/<title|name="description"|property="og:|name="twitter:/);
  });
});
