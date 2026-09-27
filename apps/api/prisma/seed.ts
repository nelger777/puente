import type { BusinessHours } from "@puente/shared";
import { BusinessHoursSchema } from "@puente/shared";
import { createDb } from "../src/db/client";
import { newId, newPublicKey } from "../src/lib/ids";
import { loadRootEnv } from "../src/lib/load-env";
import { hashPassword } from "../src/lib/password";

loadRootEnv();

const DEV_ADMIN_PASSWORD = "puente-admin-dev";
// docker compose passes unset variables as empty strings: treat "" as missing.
const envOr = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const adminEmail = envOr("SEED_ADMIN_EMAIL", "admin@opticamirador.com").toLowerCase();
const adminPassword = envOr("SEED_ADMIN_PASSWORD", DEV_ADMIN_PASSWORD);
if (
  process.env.NODE_ENV === "production" &&
  (adminPassword === DEV_ADMIN_PASSWORD || adminPassword.length < 12)
) {
  throw new Error("Set SEED_ADMIN_PASSWORD (12+ characters) to seed a production database");
}

// Fixed key outside production so the widget demo works without copying keys around.
const isProduction = process.env.NODE_ENV === "production";
const publicKey =
  process.env.SEED_PUBLIC_KEY?.trim() || (isProduction ? newPublicKey() : "pk_demo_opticamirador");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const db = createDb(databaseUrl);

const hours: BusinessHours = BusinessHoursSchema.parse({
  days: [1, 2, 3, 4, 5, 6],
  from: "08:00",
  to: "18:00",
});

const knowledge = [
  ["¿Cuál es el horario?", "Atendemos de lunes a sábado de 08:00 a 18:00."],
  [
    "¿Hacen examen de la vista?",
    "Sí, el examen visual es gratuito al comprar tus lentes. Sin compra cuesta Gs. 50.000.",
  ],
  [
    "¿Cuánto tarda un pedido de lentes?",
    "Los lentes monofocales están en 3 días hábiles; los multifocales en 7 días hábiles.",
  ],
  [
    "¿Aceptan tarjetas?",
    "Aceptamos tarjetas de crédito y débito, transferencia y efectivo. Hasta 6 cuotas sin intereses con tarjetas seleccionadas.",
  ],
  [
    "¿Dónde están ubicados?",
    "Estamos en Av. Principal 1234, frente a la plaza. Hay estacionamiento gratuito.",
  ],
] as const;

const businessData = {
  name: "Óptica Mirador",
  kind: "óptica",
  botName: "Luz",
  brandColor: "#1F5FBF",
  whatsappNumber: "595981000000",
  notifyEmail: "equipo@opticamirador.com",
  timezone: "America/Asuncion",
  hours,
  offHoursMessage:
    "El equipo atiende de lunes a sábado de 08:00 a 18:00. Te responderán apenas abran.",
  greeting:
    "¡Hola! Soy Luz de Óptica Mirador. Respondo tus consultas al instante y, si necesitas a una persona, te conecto con el equipo.",
  suggestions: ["¿Cuál es el horario?", "¿Hacen examen de la vista?", "Hablar con una persona"],
  sensitiveTopics: ["reclamo", "garantía", "receta médica", "reembolso"],
  allowedDomains: ["opticamirador.com"],
};

async function main() {
  const passwordHash = await hashPassword(adminPassword);

  const business = await db.$transaction(async (tx) => {
    const biz = await tx.business.upsert({
      where: { slug: "optica-mirador" },
      update: isProduction ? businessData : { ...businessData, publicKey },
      create: { id: newId("biz"), slug: "optica-mirador", publicKey, ...businessData },
    });

    await tx.knowledgeItem.deleteMany({ where: { businessId: biz.id } });
    await tx.knowledgeItem.createMany({
      data: knowledge.map(([question, answer], position) => ({
        id: newId("kb"),
        businessId: biz.id,
        question,
        answer,
        position,
      })),
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

    return biz;
  });

  console.warn(
    [
      `Seeded "${business.name}" (${business.id})`,
      `  publicKey: ${business.publicKey}`,
      `  admin:     ${adminEmail}${adminPassword === DEV_ADMIN_PASSWORD ? ` / ${DEV_ADMIN_PASSWORD}` : ""}`,
    ].join("\n"),
  );
}

try {
  await main();
} finally {
  await db.$disconnect();
}
