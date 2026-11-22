import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { methodNotAllowed, notFound, type Reply } from "./http.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** HTML must never be rewritten at the edge (no beacon injection) and must be revalidated on every visit. */
export const HTML_CACHE = "no-cache, no-transform";
/** Vite puts content-hashed files under `/assets/`; they can be cached for a year. */
const HASHED_CACHE = "public, max-age=31536000, immutable";
const OTHER_CACHE = "public, max-age=300";

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves the built site from `root`. Paths without an extension that are not files fall back to `index.html`
 * (client-side routes). Anything that resolves outside `root` is a 404.
 */
export class StaticSite {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async handle(method: string, rawUrl: string): Promise<Reply> {
    if (method !== "GET" && method !== "HEAD") return methodNotAllowed("GET, HEAD");
    let path: string;
    try {
      path = decodeURIComponent(new URL(rawUrl, "http://local").pathname);
    } catch {
      return notFound();
    }
    if (path.includes("\0")) return notFound();
    const target = resolve(join(this.#root, path.endsWith("/") ? `${path}index.html` : path));
    if (target !== this.#root && !target.startsWith(this.#root + sep)) return notFound();

    if (await isFile(target)) return this.#file(target, path);
    if (extname(path) === "") {
      const index = join(this.#root, "index.html");
      if (await isFile(index)) return this.#file(index, "/index.html");
      return { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }, body: "site not built" };
    }
    return notFound();
  }

  async #file(target: string, path: string): Promise<Reply> {
    const ext = extname(target).toLowerCase();
    const type = TYPES[ext] ?? "application/octet-stream";
    const cache = ext === ".html" ? HTML_CACHE : path.startsWith("/assets/") ? HASHED_CACHE : OTHER_CACHE;
    return { status: 200, headers: { "content-type": type, "cache-control": cache }, body: await readFile(target) };
  }
}
