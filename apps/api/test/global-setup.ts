import { execSync } from "node:child_process";

/** Applies pending migrations to the test database before any test runs. */
export default function setup(): void {
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}
