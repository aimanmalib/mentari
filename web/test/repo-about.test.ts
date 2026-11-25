import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// config/repo.json is the GitHub About box (scripts/repo-about.sh writes it). These tests keep its shape inside GitHub's
// limits and keep the homepage on the same site the app shares, so the About box cannot point a judge somewhere else.
const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const repo = JSON.parse(read("config/repo.json"));
const app = JSON.parse(read("config/app.json"));

describe("config/repo.json", () => {
  it("has a description GitHub accepts, in plain sentences", () => {
    expect(typeof repo.description).toBe("string");
    expect(repo.description.length).toBeGreaterThan(0);
    expect(repo.description.length).toBeLessThanOrEqual(350);
    expect(repo.description).not.toMatch(/[—–]/);
  });

  it("uses the site the app shares as the homepage", () => {
    expect(repo.homepage).toBe(app.web.share.siteUrl);
  });

  it("has unique topics in GitHub's format", () => {
    expect(Array.isArray(repo.topics)).toBe(true);
    expect(repo.topics.length).toBeGreaterThan(0);
    expect(repo.topics.length).toBeLessThanOrEqual(20);
    expect(new Set(repo.topics).size).toBe(repo.topics.length);
    for (const t of repo.topics) expect(t).toMatch(/^[a-z0-9][a-z0-9-]{0,49}$/);
  });

  it("names the repo whose links the README uses", () => {
    expect(app.web.links.source).toBe(`https://github.com/${repo.repo}`);
  });
});

describe.each(["README.md", "README.ms.md"])("%s video block", (file) => {
  // The poster opens the same video page the site links to (config/app.json web.links.video), or the MP4 copy while
  // that is empty. The MP4 copy stays linked in the header either way.
  it("shows a poster in the header that opens the demo video, and the poster file exists", () => {
    const head = read(file).split("\n## ")[0] ?? "";
    const target: string = app.web.links.video || "docs/video/mentari-demo.mp4";
    const escaped = target.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const block = head.match(new RegExp(`<a href="${escaped}"><img src="([^"]+)"[^>]*></a>`));
    expect(block, file).not.toBeNull();
    expect(existsSync(new URL(block?.[1] ?? "", root)), `${file}: ${block?.[1]}`).toBe(true);
    expect(head).toContain('href="docs/video/mentari-demo.mp4"');
  });
});
