import { defineConfig, devices } from "@playwright/test";

const API_PORT = 3100;
const PANEL_PORT = 5181;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PANEL_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Real API routes and database, fake LLM (never calls Anthropic).
      command: "pnpm --filter @puente/api e2e:server",
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: { E2E_API_PORT: String(API_PORT), E2E_PANEL_URL: `http://localhost:${PANEL_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      // Same origin as in production: the panel proxies /v1 to the API.
      command: `pnpm exec vite --port ${PANEL_PORT} --strictPort`,
      url: `http://localhost:${PANEL_PORT}/login`,
      env: { PANEL_API_TARGET: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
