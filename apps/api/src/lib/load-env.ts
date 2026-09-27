import { resolve } from "node:path";

/** Loads the repo-level .env for local development. Existing env vars always win. */
export function loadRootEnv(): void {
  try {
    process.loadEnvFile(resolve(import.meta.dirname, "../../../../.env"));
  } catch {
    // no .env file: rely on the environment (CI, containers)
  }
}
