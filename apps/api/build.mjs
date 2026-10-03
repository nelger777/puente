// Production bundle: one ESM file per entry point. npm dependencies stay external (installed
// in the image); the workspace package @puente/shared (TypeScript source) is bundled in.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith("@puente/"));

await build({
  entryPoints: {
    server: "src/server.ts",
    seed: "prisma/seed.ts",
    retention: "src/scripts/retention.ts",
    "set-quota": "src/scripts/set-quota.ts",
  },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external: external.flatMap((name) => [name, `${name}/*`]),
  logLevel: "info",
});
