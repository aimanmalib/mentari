import { describe, expect, it } from "vitest";
import { CidrSet, clientIp, normalizeIp } from "../src/ip.js";

const rules = {
  trustedProxies: new CidrSet(["127.0.0.0/8", "::1/128", "172.16.0.0/12"]),
  cloudflare: new CidrSet(["173.245.48.0/20", "2606:4700::/32"]),
};
const CF4 = "173.245.48.10";

describe("CidrSet", () => {
  it("matches IPv4, IPv6 and IPv4-mapped IPv6", () => {
    expect(rules.cloudflare.has(CF4)).toBe(true);
    expect(rules.cloudflare.has(`::ffff:${CF4}`)).toBe(true);
    expect(rules.cloudflare.has("2606:4700::1")).toBe(true);
    expect(rules.cloudflare.has("173.245.64.1")).toBe(false);
    expect(rules.cloudflare.has("not-an-ip")).toBe(false);
  });

  it("rejects malformed ranges", () => {
    expect(() => new CidrSet(["1.2.3.0/33"])).toThrow(/bad CIDR/);
    expect(() => new CidrSet(["1.2.3.0"])).toThrow(/bad CIDR/);
    expect(() => new CidrSet(["nope/8"])).toThrow(/bad CIDR/);
  });
});

describe("normalizeIp", () => {
  it("unwraps mapped addresses and refuses junk", () => {
    expect(normalizeIp(" ::ffff:10.0.0.1 ")).toBe("10.0.0.1");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIp("1.2.3.4; drop")).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});

describe("clientIp", () => {
  it("believes cf-connecting-ip when Cloudflare is the direct peer", () => {
    expect(clientIp(CF4, { "cf-connecting-ip": "203.0.113.7" }, rules)).toBe("203.0.113.7");
  });

  it("believes cf-connecting-ip when traefik forwarded a Cloudflare hop", () => {
    const h = { "x-forwarded-for": `198.51.100.1, ${CF4}`, "cf-connecting-ip": "203.0.113.7" };
    expect(clientIp("172.18.0.2", h, rules)).toBe("203.0.113.7");
  });

  it("ignores a forged cf-connecting-ip from a direct client", () => {
    expect(clientIp("198.51.100.9", { "cf-connecting-ip": "203.0.113.7" }, rules)).toBe("198.51.100.9");
  });

  it("ignores a forged Cloudflare entry earlier in x-forwarded-for", () => {
    const h = { "x-forwarded-for": `${CF4}, 198.51.100.9`, "cf-connecting-ip": "203.0.113.7" };
    expect(clientIp("172.18.0.2", h, rules)).toBe("198.51.100.9");
  });

  it("ignores x-forwarded-for when the peer is not a trusted proxy", () => {
    const h = { "x-forwarded-for": CF4, "cf-connecting-ip": "203.0.113.7" };
    expect(clientIp("198.51.100.9", h, rules)).toBe("198.51.100.9");
  });

  it("falls back to the hop when cf-connecting-ip is not an IP", () => {
    expect(clientIp(CF4, { "cf-connecting-ip": "evil" }, rules)).toBe(CF4);
  });

  it("uses the last value of a repeated header", () => {
    expect(clientIp(CF4, { "cf-connecting-ip": ["203.0.113.1", "203.0.113.2"] }, rules)).toBe("203.0.113.2");
  });

  it("returns a stable label when the peer is unknown", () => {
    expect(clientIp(undefined, {}, rules)).toBe("unknown");
  });
});
