// The Docker image builds the web app from a context that .dockerignore trims. A web source file that imports
// from a trimmed folder builds on a laptop and fails only in deploy/deploy.sh (it did once: the home poster
// came from brand/). These tests read the real .dockerignore and the real sources.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import app from "../../config/app.json" with { type: "json" };

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webSrc = join(repo, "web/src");

/** Top-level folders .dockerignore leaves out, from lines like `brand/` (no globs, no negations). */
function ignoredFolders(dockerignore: string): string[] {
  return dockerignore
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9._-]+\/$/.test(line))
    .map((line) => line.slice(0, -1));
}

/** Relative import and glob specifiers in a source file. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|import\.meta\.glob\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
    if (m[1]) found.push(m[1]);
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(e.name) ? [path] : [];
  });
}

describe("web sources and the Docker build context", () => {
  const ignored = ignoredFolders(readFileSync(join(repo, ".dockerignore"), "utf8"));

  it("reads the trimmed folders from .dockerignore", () => {
    expect(ignored).toContain("brand");
    expect(ignored).toContain("docs");
  });

  it("no web source imports a file from a folder the image build never sees", () => {
    const misses: string[] = [];
    for (const file of sourceFiles(webSrc)) {
      for (const spec of specifiers(readFileSync(file, "utf8"))) {
        const top = relative(repo, resolve(dirname(file), spec)).split(sep)[0] ?? "";
        if (ignored.includes(top)) misses.push(`${relative(repo, file)} -> ${spec}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("the home page copy of the cover matches the committed cover", () => {
    const { image, webCopy } = app.web.cover;
    expect(webCopy.startsWith("web/")).toBe(true);
    expect(readFileSync(join(repo, webCopy)).equals(readFileSync(join(repo, image)))).toBe(true);
  });

  it("the scan catches an import from a trimmed folder", () => {
    expect(specifiers('import poster from "../../../brand/mentari-cover.png";')).toEqual(["../../../brand/mentari-cover.png"]);
    expect(ignoredFolders("# note\nbrand/\n**/dist\n!keep/\ndeploy/hos.env\n")).toEqual(["brand"]);
  });
});
