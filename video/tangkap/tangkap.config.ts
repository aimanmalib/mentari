import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "**/tangkap.e2e.ts", workers: 1, fullyParallel: false, timeout: 540_000, reporter: "list", projects: [{ name: "all", use: {} }] });
