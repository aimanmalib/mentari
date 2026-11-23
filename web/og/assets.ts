// The files both image renders share: the site's fonts, its design tokens and the brand mark, read from disk.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CardFont } from "./card.js";

export const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const repoDir = join(webDir, "..");
export const readWeb = (path: string) => readFileSync(join(webDir, path));

const font = (pkg: string, file: string, family: string, weight: string, stretch?: string): CardFont => ({
  family,
  woff2: readWeb(`node_modules/${pkg}/files/${file}`),
  weight,
  ...(stretch ? { stretch } : {}),
});

export function siteFonts(): CardFont[] {
  return [
    font("@fontsource-variable/bricolage-grotesque", "bricolage-grotesque-latin-wdth-normal.woff2",
      "Bricolage Grotesque Variable", "200 800", "75% 100%"),
    font("@fontsource-variable/instrument-sans", "instrument-sans-latin-wght-normal.woff2",
      "Instrument Sans Variable", "400 700"),
    font("@fontsource/ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2", "IBM Plex Mono", "500"),
  ];
}

export const tokensCss = () => readWeb("src/styles/tokens.css").toString("utf8");
export const logoSvg = () => readFileSync(join(repoDir, "brand/logo.svg"), "utf8");
