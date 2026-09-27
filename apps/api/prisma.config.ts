import { defineConfig, env } from "prisma/config";

// Local development reads the repo-level .env; CI and containers provide real env vars.
try {
  process.loadEnvFile("../../.env");
} catch {
  // no .env file: rely on the environment
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
