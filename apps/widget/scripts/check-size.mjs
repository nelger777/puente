// Fails the build when the widget bundle exceeds the size budget (docs/SPEC.md §6).
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const LIMIT = 40 * 1024;
const file = new URL("../dist/v1.js", import.meta.url);
const size = gzipSync(readFileSync(file)).length;
const kb = (size / 1024).toFixed(1);
if (size > LIMIT) {
  console.error(`dist/v1.js pesa ${kb} KB gzip; el máximo es 40 KB.`);
  process.exit(1);
}
console.warn(`dist/v1.js: ${kb} KB gzip (máximo 40 KB)`);
