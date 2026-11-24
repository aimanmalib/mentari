import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";
import { DEMO_MOUNT, type DemoApi } from "./demo/api.js";
import { EXPLORER_MOUNT, RECEIPT_MOUNT, type ExplorerLinks } from "./explorer.js";
import { json, methodNotAllowed, notFound, type Reply } from "./http.js";
import { CidrSet, clientIp, type ClientIpRules } from "./ip.js";
import { LCD_MOUNT, type LcdProxy } from "./lcd.js";
import type { StaticSite } from "./static.js";

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};

export interface AppParts {
  cfg: ServerConfig;
  lcd: LcdProxy;
  explorer: ExplorerLinks;
  demo: DemoApi;
  site: StaticSite;
}

/** Request facts every handler may use. `ip` is the rate-limit identity (see `clientIp`). */
export interface RequestInfo {
  method: string;
  url: string;
  ip: string;
  contentType?: string | undefined;
}

function isMount(url: string, mount: string): boolean {
  return url === mount || url.startsWith(`${mount}/`) || url.startsWith(`${mount}?`);
}

export async function route(info: RequestInfo, parts: AppParts): Promise<Reply> {
  const { method, url } = info;
  if (url === "/healthz" || url.startsWith("/healthz?")) {
    return method === "GET" || method === "HEAD" ? json(200, { ok: true }) : methodNotAllowed("GET, HEAD");
  }
  if (isMount(url, LCD_MOUNT)) return parts.lcd.handle(method, url);
  if (isMount(url, EXPLORER_MOUNT)) return parts.explorer.handle(method, url);
  if (isMount(url, RECEIPT_MOUNT)) return parts.explorer.handleReceipt(method, url);
  if (isMount(url, DEMO_MOUNT)) return parts.demo.handle(info);
  if (isMount(url, "/api")) return notFound();
  return parts.site.handle(method, url);
}

export function ipRules(cfg: ServerConfig): ClientIpRules {
  return { trustedProxies: new CidrSet(cfg.clientIp.trustedProxies), cloudflare: new CidrSet(cfg.clientIp.cloudflare) };
}

/** Node `http` request listener. Errors become a plain 500; nothing internal is echoed to the client. */
export function createHandler(parts: AppParts): (req: IncomingMessage, res: ServerResponse) => void {
  const rules = ipRules(parts.cfg);
  return (req, res) => {
    const info: RequestInfo = {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      ip: clientIp(req.socket.remoteAddress, req.headers, rules),
      contentType: req.headers["content-type"],
    };
    route(info, parts)
      .catch(() => json(500, { error: "internal error" }))
      .then((reply) => {
        res.writeHead(reply.status, { ...SECURITY_HEADERS, ...reply.headers });
        res.end(info.method === "HEAD" ? undefined : reply.body);
      })
      .catch(() => res.destroy());
  };
}
