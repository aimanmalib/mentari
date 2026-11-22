import type { ServerConfig } from "./config.js";
import { json, methodNotAllowed, notFound, type Reply } from "./http.js";

export const LCD_MOUNT = "/lcd";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

interface Cached {
  status: number;
  contentType: string;
  body: Buffer;
  expires: number;
}

class TooLarge extends Error {}

/** True when `path` is covered by one allowed prefix. A prefix ending in "/" covers a subtree; otherwise it is exact. */
export function isAllowedPath(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => (p.endsWith("/") ? path.startsWith(p) && path.length > p.length : path === p));
}

/**
 * Turn the part of a request URL after `/lcd` into an upstream URL, or `null` when it must not be fetched.
 * The URL parser normalises dot segments; if normalising changed anything, or the origin moved, the request is refused.
 */
export function upstreamUrl(rest: string, origin: string, prefixes: readonly string[]): URL | null {
  const q = rest.indexOf("?");
  const path = q === -1 ? rest : rest.slice(0, q);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(origin + rest);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== path || url.username || url.password) return null;
  return isAllowedPath(url.pathname, prefixes) ? url : null;
}

async function readCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) throw new TooLarge();
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > max) throw new TooLarge();
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Read-only proxy to the Native REST API: GET only, allowed prefixes only, one fixed origin, short cache. */
export class LcdProxy {
  readonly #cfg: ServerConfig;
  readonly #fetch: Fetch;
  readonly #now: () => number;
  readonly #cache = new Map<string, Cached>();
  readonly #inflight = new Map<string, Promise<Cached>>();

  constructor(cfg: ServerConfig, fetchImpl: Fetch = fetch, now: () => number = Date.now) {
    this.#cfg = cfg;
    this.#fetch = fetchImpl;
    this.#now = now;
  }

  async handle(method: string, rawUrl: string): Promise<Reply> {
    if (method !== "GET") return methodNotAllowed("GET");
    const url = upstreamUrl(rawUrl.slice(LCD_MOUNT.length), this.#cfg.restOrigin, this.#cfg.lcd.allowedPrefixes);
    if (!url) return notFound();
    const key = url.pathname + url.search;

    let entry = this.#cache.get(key);
    if (!entry || entry.expires <= this.#now()) {
      let pending = this.#inflight.get(key);
      if (!pending) {
        pending = this.#load(url, key).finally(() => this.#inflight.delete(key));
        this.#inflight.set(key, pending);
      }
      try {
        entry = await pending;
      } catch (err) {
        const reason = err instanceof TooLarge ? "upstream reply too large" : "upstream unavailable";
        return json(502, { error: reason });
      }
    }
    return {
      status: entry.status,
      headers: {
        "content-type": entry.contentType,
        "cache-control": `public, max-age=${this.#cfg.lcd.cacheSeconds}`,
      },
      body: entry.body,
    };
  }

  async #load(url: URL, key: string): Promise<Cached> {
    const { timeoutMs, maxBodyBytes, cacheSeconds, cacheMaxEntries } = this.#cfg.lcd;
    const res = await this.#fetch(url.href, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const entry: Cached = {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      body: await readCapped(res, maxBodyBytes),
      expires: this.#now() + cacheSeconds * 1000,
    };
    if (res.status < 500) {
      this.#cache.delete(key);
      this.#cache.set(key, entry);
      while (this.#cache.size > cacheMaxEntries) {
        const oldest = this.#cache.keys().next().value;
        if (oldest === undefined) break;
        this.#cache.delete(oldest);
      }
    }
    return entry;
  }
}
