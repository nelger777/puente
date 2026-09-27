import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Same origin as the API: in development Vite proxies /v1, in production a reverse proxy
// (or the API itself) serves the panel and /v1 under one domain (docs/DECISIONS.md).
const apiTarget = process.env.PANEL_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { "/v1": { target: apiTarget, changeOrigin: false } },
  },
  test: { include: ["test/**/*.test.ts"] },
});
