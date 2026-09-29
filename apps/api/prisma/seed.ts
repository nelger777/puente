// Seeds one business with its knowledge base and an admin user.
//   SEED_BUSINESS        which file of prisma/businesses/ to load (default: optica-mirador)
//   SEED_ADMIN_EMAIL     admin to create, or to move to this business if it already exists
//   SEED_ADMIN_PASSWORD  required (12+ characters) in production
// Re-running updates the business and replaces its knowledge base (conversations are kept).
import { BusinessSettingsSchema, KnowledgePutSchema } from "@puente/shared";
import { z } from "zod";
import { createDb } from "../src/db/client";
import { newId, newPublicKey } from "../src/lib/ids";
import { loadRootEnv } from "../src/lib/load-env";
import { hashPassword } from "../src/lib/password";
import laRural from "./businesses/la-rural.json";
import opticaMirador from "./businesses/optica-mirador.json";

const BusinessFileSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** Fixed key outside production so local demos work without copying keys. */
  devPublicKey: z.string(),
  devAdminEmail: z.email(),
  settings: BusinessSettingsSchema,
  knowledge: KnowledgePutSchema.shape.items,
});

const BUSINESSES: Record<string, unknown> = {
  "optica-mirador": opticaMirador,
  "la-rural": laRural,
};

loadRootEnv();

const DEV_ADMIN_PASSWORD = "puente-admin-dev";
// docker compose passes unset variables as empty strings: treat "" as missing.
const envOr = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const isProduction = process.env.NODE_ENV === "production";

const which = envOr("SEED_BUSINESS", "optica-mirador");
const source = BUSINESSES[which];
if (!source) {
  throw new Error(
    `Unknown SEED_BUSINESS "${which}". Options: ${Object.keys(BUSINESSES).join(", ")}`,
  );
}
const { slug, devPublicKey, devAdminEmail, settings, knowledge } = BusinessFileSchema.parse(source);

const adminEmail = envOr("SEED_ADMIN_EMAIL", devAdminEmail).toLowerCase();
const adminPassword = envOr("SEED_ADMIN_PASSWORD", DEV_ADMIN_PASSWORD);
if (isProduction && (adminPassword === DEV_ADMIN_PASSWORD || adminPassword.length < 12)) {
  throw new Error("Set SEED_ADMIN_PASSWORD (12+ characters) to seed a production database");
}
const publicKey =
  process.env.SEED_PUBLIC_KEY?.trim() || (isProduction ? newPublicKey() : devPublicKey);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const db = createDb(databaseUrl);

async function main() {
  const passwordHash = await hashPassword(adminPassword);

  const { business, movedFrom } = await db.$transaction(async (tx) => {
    const biz = await tx.business.upsert({
      where: { slug },
      // In production the key of an existing business never changes (sites already embed it).
      update: isProduction ? settings : { ...settings, publicKey },
      create: { id: newId("biz"), slug, publicKey, ...settings },
    });

    await tx.knowledgeItem.deleteMany({ where: { businessId: biz.id } });
    await tx.knowledgeItem.createMany({
      data: knowledge.map((item, position) => ({
        id: newId("kb"),
        businessId: biz.id,
        question: item.question,
        answer: item.answer,
        position,
      })),
    });

    const existing = await tx.user.findUnique({
      where: { email: adminEmail },
      select: { business: { select: { id: true, name: true } } },
    });
    await tx.user.upsert({
      where: { email: adminEmail },
      update: {
        businessId: biz.id,
        passwordHash,
        role: "ADMIN",
        failedLoginCount: 0,
        lockedUntil: null,
      },
      create: {
        id: newId("usr"),
        businessId: biz.id,
        email: adminEmail,
        passwordHash,
        role: "ADMIN",
      },
    });

    const previous = existing?.business;
    return { business: biz, movedFrom: previous && previous.id !== biz.id ? previous.name : null };
  });

  console.warn(
    [
      `Seeded "${business.name}" (${business.id}) with ${knowledge.length} knowledge items`,
      `  publicKey: ${business.publicKey}`,
      `  admin:     ${adminEmail}${adminPassword === DEV_ADMIN_PASSWORD ? ` / ${DEV_ADMIN_PASSWORD}` : ""}`,
      ...(movedFrom
        ? [`  (this admin now manages "${business.name}" instead of "${movedFrom}")`]
        : []),
    ].join("\n"),
  );
}

try {
  await main();
} finally {
  await db.$disconnect();
}
