// After `vite build`: enforce the size budget (docs/SPEC.md §6) and publish an immutable,
// content-hashed copy next to the stable URL.
//   /widget/v1.js          → what merchants embed (short cache, always the latest v1)
//   /widget/v1.<hash>.js   → pinned copy (cached for a year)
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LIMIT = 40 * 1024;
const dist = new URL("../dist/", import.meta.url);
const bundle = readFileSync(new URL("v1.js", dist));

const size = gzipSync(bundle).length;
const kb = (size / 1024).toFixed(1);
if (size > LIMIT) {
  console.error(`dist/v1.js pesa ${kb} KB gzip; el máximo es 40 KB.`);
  process.exit(1);
}

for (const file of readdirSync(dist)) {
  if (/^v1\.[0-9a-f]{8}\.js$/.test(file)) rmSync(new URL(file, dist));
}
const hash = createHash("sha256").update(bundle).digest("hex").slice(0, 8);
writeFileSync(new URL(`v1.${hash}.js`, dist), bundle);
writeFileSync(
  new URL("manifest.json", dist),
  JSON.stringify({ stable: "v1.js", pinned: `v1.${hash}.js` }, null, 2),
);
console.warn(`dist/v1.js: ${kb} KB gzip (máximo 40 KB) · copia fija: v1.${hash}.js`);
