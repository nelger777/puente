import { defineConfig } from "vite";

// Library mode: a single self-contained file (dist/v1.js) loaded with <script async>.
export default defineConfig({
  build: {
    target: "es2020",
    lib: {
      entry: "src/index.ts",
      name: "PuenteWidget",
      formats: ["iife"],
      fileName: () => "v1.js",
    },
  },
});
