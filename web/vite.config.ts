import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server forwards the same paths the Node server answers in production.
const api = process.env.MENTARI_SERVER ?? "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
  server: { proxy: { "/lcd": api, "/api": api, "/healthz": api } },
});
