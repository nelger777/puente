import { defineConfig } from "vitest/config";

// Library mode: one self-contained file (dist/v1.js) loaded with <script async>.
export default defineConfig({
  define: {
    // API used by the bundle unless the <script> sets data-api.
    __PUENTE_API_URL__: JSON.stringify(process.env.PUBLIC_API_URL ?? "http://localhost:3000"),
  },
  build: {
    target: "es2020",
    lib: {
      entry: "src/index.ts",
      name: "PuenteWidget",
      formats: ["iife"],
      fileName: () => "v1.js",
    },
  },
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts"],
  },
});
