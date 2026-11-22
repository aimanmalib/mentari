import { BlockList, isIP } from "node:net";

/** A set of CIDR ranges (IPv4 and IPv6). IPv4-mapped IPv6 addresses match their IPv4 range. */
export class CidrSet {
  readonly #list = new BlockList();

  constructor(cidrs: readonly string[]) {
    for (const c of cidrs) {
      const [net, bitsText] = c.split("/");
      const family = net ? isIP(net) : 0;
      const bits = Number(bitsText);
      const max = family === 4 ? 32 : 128;
      if (!net || family === 0 || !Number.isInteger(bits) || bits < 0 || bits > max) {
        throw new Error(`bad CIDR "${c}"`);
      }
      this.#list.addSubnet(net, bits, family === 4 ? "ipv4" : "ipv6");
    }
  }

  has(address: string): boolean {
    const ip = normalizeIp(address);
    if (ip === null) return false;
    return this.#list.check(ip, isIP(ip) === 4 ? "ipv4" : "ipv6");
  }
}

/** Plain IP text, IPv4-mapped IPv6 unwrapped; `null` when `raw` is not an IP. */
export function normalizeIp(raw: string | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped?.[1]) ip = mapped[1];
  return isIP(ip) === 0 ? null : ip;
}

export interface ClientIpRules {
  trustedProxies: CidrSet;
  cloudflare: CidrSet;
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[v.length - 1] : v;
}

/**
 * The visitor address used for rate limits.
 *
 * 1. Start from the TCP peer.
 * 2. If the peer is a trusted local proxy (traefik), step back one hop: the last `x-forwarded-for` entry is the address
 *    that proxy saw. Earlier entries are written by the client and are ignored.
 * 3. Only if that hop is a Cloudflare edge address is `cf-connecting-ip` believed.
 *
 * A client that connects directly can therefore never choose its own address.
 */
export function clientIp(
  peer: string | undefined,
  headers: Record<string, string | string[] | undefined>,
  rules: ClientIpRules,
): string {
  let hop = normalizeIp(peer) ?? "unknown";
  if (rules.trustedProxies.has(hop)) {
    const xff = header(headers, "x-forwarded-for");
    const last = xff?.split(",").at(-1);
    const forwarded = normalizeIp(last);
    if (forwarded) hop = forwarded;
  }
  if (rules.cloudflare.has(hop)) {
    const cf = normalizeIp(header(headers, "cf-connecting-ip"));
    if (cf) return cf;
  }
  return hop;
}
