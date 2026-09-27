// Manual or cron run: `pnpm --filter @puente/api retention`.
import { createDb } from "../db/client";
import { parseEnv } from "../lib/env";
import { loadRootEnv } from "../lib/load-env";
import { runRetention } from "../services/retention";

loadRootEnv();
const env = parseEnv();
const db = createDb(env.DATABASE_URL);
try {
  const result = await runRetention(db, env.RETENTION_DAYS, new Date());
  console.warn(
    `Retention (${env.RETENTION_DAYS} days, before ${result.cutoff.toISOString()}): ` +
      `${result.conversations} conversations, ${result.sessions} expired sessions deleted.`,
  );
} finally {
  await db.$disconnect();
}
