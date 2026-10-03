// Operator command: sets a business's monthly conversation quota (the panel cannot change it).
// `pnpm --filter @puente/api quota <slug> <conversations|none>`; in production
// `docker compose exec api node dist/set-quota.js <slug> <conversations|none>`.
import { createDb } from "../db/client";
import { parseEnv } from "../lib/env";
import { loadRootEnv } from "../lib/load-env";

const [slug, value] = process.argv.slice(2);
const quota = value === "none" ? null : Number(value);
if (!slug || (quota !== null && (!Number.isInteger(quota) || quota <= 0))) {
  console.error("Uso: set-quota <slug> <conversaciones por mes | none>");
  process.exit(1);
}

loadRootEnv();
const env = parseEnv();
const db = createDb(env.DATABASE_URL);
try {
  const updated = await db.business.updateMany({
    where: { slug },
    data: { monthlyConversationQuota: quota },
  });
  if (updated.count === 0) {
    console.error(`No existe un negocio con slug "${slug}".`);
    process.exitCode = 1;
  } else {
    console.warn(
      quota === null
        ? `${slug}: sin tope mensual de conversaciones.`
        : `${slug}: tope de ${quota} conversaciones por mes.`,
    );
  }
} finally {
  await db.$disconnect();
}
