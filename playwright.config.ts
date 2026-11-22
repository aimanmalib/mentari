import { defineConfig, devices } from "@playwright/test";
import fixture from "./web/e2e/fixture.json" with { type: "json" };

// End-to-end tests of the site in a real browser. The site is built in e2e mode (a test contract address, see
// web/vite.config.ts) and served statically; every chain and server call is answered inside the test.
const baseURL = `http://127.0.0.1:${fixture.port}`;

export default defineConfig({
  testDir: "web/e2e",
  // `.e2e.ts`, so vitest (which picks up `*.spec.ts`) never runs these.
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit-iphone-13", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `pnpm --filter @mentari/web exec vite build --mode e2e --outDir e2e/dist && pnpm --filter @mentari/web exec vite preview --mode e2e --outDir e2e/dist --host 127.0.0.1 --port ${fixture.port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
