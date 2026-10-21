// Operator command: grants or removes the platform admin flag (the panel cannot change it).
// `pnpm --filter @puente/api platform-admin <email> <on|off>`; in production
// `docker compose exec api node dist/set-platform-admin.js <email> <on|off>`.
import { createDb } from "../db/client";
import { parseEnv } from "../lib/env";
import { loadRootEnv } from "../lib/load-env";

const [rawEmail, value] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (!email || (value !== "on" && value !== "off")) {
  console.error("Uso: set-platform-admin <correo> <on|off>");
  process.exit(1);
}
const on = value === "on";

loadRootEnv();
const env = parseEnv();
const db = createDb(env.DATABASE_URL);
try {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    console.error(`No existe un usuario con correo "${email}".`);
    process.exitCode = 1;
  } else {
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { isPlatformAdmin: on } }),
      // Removing the flag also takes the user out of any business they had entered.
      ...(on
        ? []
        : [
            db.session.updateMany({ where: { userId: user.id }, data: { actingBusinessId: null } }),
          ]),
    ]);
    console.warn(
      on
        ? `${email}: ahora administra la plataforma (Empresas en el panel).`
        : `${email}: ya no administra la plataforma.`,
    );
  }
} finally {
  await db.$disconnect();
}
