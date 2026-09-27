import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3100;
const SITE_PORT = 5180;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${SITE_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Real API routes and database, fake LLM (never calls Anthropic).
      command: "pnpm --filter @puente/api e2e:server",
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: { E2E_API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Builds dist/v1.js (the real bundle) and serves the demo site next to it.
      command: `pnpm build && pnpm exec vite --port ${SITE_PORT} --strictPort`,
      url: `http://localhost:${SITE_PORT}/demo/index.html`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
