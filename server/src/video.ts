import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { methodNotAllowed, notFound, type Reply } from "./http.js";

/** The demo video copy (`web.links.videoCopy` and `web.videoCopyFile` of `config/app.json`, decision 0032). */
export interface VideoCopyConfig {
  /** Public route, e.g. `/video/mentari.mp4`. Empty = no copy. */
  path: string;
  /** Size the file must have; any other size is not served. */
  bytes: number;
  sha256: string;
  cacheSeconds: number;
}

export type ByteRange = { start: number; end: number } | "unsatisfiable" | null;

/**
 * Reads one `Range: bytes=...` header for a file of `size` bytes. Returns null when there is no usable single range
 * (the whole file is sent), or "unsatisfiable" when the range starts past the end.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return "unsatisfiable";
  if (end < start) return null;
  return { start, end };
}

/** Serves one MP4 from a read-only folder, with byte ranges so players can seek. */
export class VideoCopy {
  readonly #cfg: VideoCopyConfig;
  readonly #file: string | undefined;

  constructor(cfg: VideoCopyConfig, dir: string | undefined) {
    this.#cfg = cfg;
    this.#file = cfg.path && dir ? join(dir, basename(cfg.path)) : undefined;
  }

  /** True when `url` is the copy's route (with or without a query string). */
  matches(url: string): boolean {
    const p = this.#cfg.path;
    return p !== "" && (url === p || url.startsWith(`${p}?`));
  }

  async handle(method: string, range: string | undefined): Promise<Reply> {
    if (method !== "GET" && method !== "HEAD") return methodNotAllowed("GET, HEAD");
    if (!this.#file) return notFound();
    let size: number;
    try {
      const s = await stat(this.#file);
      if (!s.isFile()) return notFound();
      size = s.size;
    } catch {
      return notFound();
    }
    // A file of another size is not the film the config names: say nothing rather than serve it.
    if (size !== this.#cfg.bytes) return notFound();

    const headers: Record<string, string> = {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "cache-control": `public, max-age=${this.#cfg.cacheSeconds}`,
      etag: `"${this.#cfg.sha256.slice(0, 32)}"`,
    };
    const r = parseRange(range, size);
    if (r === "unsatisfiable") {
      return { status: 416, headers: { ...headers, "content-range": `bytes */${size}`, "content-length": "0" }, body: "" };
    }
    const { start, end } = r ?? { start: 0, end: size - 1 };
    headers["content-length"] = String(end - start + 1);
    if (r) headers["content-range"] = `bytes ${start}-${end}/${size}`;
    const body = method === "HEAD" ? "" : createReadStream(this.#file, { start, end });
    return { status: r ? 206 : 200, headers, body };
  }
}
