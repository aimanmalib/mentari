import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import app from "../config/app.json" with { type: "json" };
import e2e from "./e2e/fixture.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import ms from "./locales/ms.json" with { type: "json" };
import { shareMeta } from "./share-meta.js";

// The dev server forwards the same paths the Node server answers in production.
const api = process.env.MENTARI_SERVER ?? "http://127.0.0.1:8080";

/** `--mode e2e`: the end-to-end tests need a contract address before one is deployed; they answer every call to it. */
function e2eContract(): Plugin {
  return {
    name: "mentari-e2e-contract",
    enforce: "pre",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/config/app.json")) return null;
      const cfg = JSON.parse(code) as { contracts: { mentari: string } };
      cfg.contracts.mentari = e2e.contract;
      return { code: JSON.stringify(cfg), map: null };
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), shareMeta(app.web, { en, ms }), ...(mode === "e2e" ? [e2eContract()] : [])],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
  server: { proxy: { "/lcd": api, "/api": api, "/healthz": api } },
}));
