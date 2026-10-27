import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env file: rely on the environment (CI)
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required to run the API tests");
if (testDatabaseUrl === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must point to a different database than DATABASE_URL");
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    env: { NODE_ENV: "test", DATABASE_URL: testDatabaseUrl },
    // Tests share one database: run files sequentially.
    fileParallelism: false,
    // Panel tests log in several users (argon2) against the real database: 5 s is too tight
    // on a busy machine.
    testTimeout: 15_000,
  },
});
