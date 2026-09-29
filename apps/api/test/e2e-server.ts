/**
 * API for the widget's Playwright tests: real routes and database, fake LLM.
 * Never calls Anthropic. Run with `pnpm --filter @puente/api e2e:server`.
 */
import { execSync } from "node:child_process";
import { buildApp } from "../src/app";
import { createDb } from "../src/db/client";
import type { LlmTransport } from "../src/engine/llm";
import { loadRootEnv } from "../src/lib/load-env";
import {
  createBusiness,
  createUser,
  FakeMailer,
  llmReply,
  PASSWORD,
  resetDb,
  TEST_ENV,
} from "./helpers";

loadRootEnv();

export const E2E_KEY = "pk_e2e_opticamirador";
const url = process.env.E2E_DATABASE_URL;
if (!url) throw new Error("E2E_DATABASE_URL is required");
if (url === process.env.DATABASE_URL) throw new Error("E2E_DATABASE_URL must not be DATABASE_URL");
const port = Number(process.env.E2E_API_PORT ?? 3100);

execSync("pnpm exec prisma migrate deploy", {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});

const db = createDb(url);
await resetDb(db);
const business = await createBusiness(db, { publicKey: E2E_KEY, allowedDomains: [] });
export const E2E_ADMIN = { email: "admin@e2e.test", password: PASSWORD };
await createUser(db, business.id, "ADMIN", E2E_ADMIN.email);

/** Answers by keyword, like a well-behaved model would. */
const ruleLlm: LlmTransport = {
  send(params) {
    const last = params.messages.at(-1);
    const text = last?.content.toLowerCase() ?? "";
    const output = text.includes("precio")
      ? {
          reply: "No tengo esa información. Te conecto con una persona del equipo.",
          handoff: true,
          reason: "sin_informacion",
          summary: "Consulta precios de lentes progresivos.",
          wa_message: "Hola, quiero saber el precio de unos lentes progresivos.",
          quick_replies: [],
        }
      : text.includes("horario")
        ? {
            reply: "Atendemos de lunes a sábado de 08:00 a 18:00.",
            handoff: false,
            reason: null,
            summary: "",
            wa_message: "",
            quick_replies: ["¿Dónde están ubicados?"],
          }
        : {
            reply: "¿En qué más te puedo ayudar?",
            handoff: false,
            reason: null,
            summary: "",
            wa_message: "",
            quick_replies: [],
          };
    return Promise.resolve(llmReply(JSON.stringify(output)));
  },
};

const app = buildApp(
  {
    db,
    env: {
      ...TEST_ENV,
      NODE_ENV: "development",
      LLM_TIMEOUT_MS: 5000,
      // The panel e2e runs Vite on this origin and proxies /v1 here.
      PANEL_URL: process.env.E2E_PANEL_URL ?? "http://localhost:5181",
      // Real address so pictures and links served by this API load in the browser.
      PUBLIC_API_URL: `http://127.0.0.1:${port}`,
    },
    llm: ruleLlm,
    mailer: new FakeMailer(),
  },
  { logger: { level: "warn" } },
);

// Test-only inspection endpoint (this server never runs in production).
app.get("/__e2e/handoffs", async () =>
  db.handoff.findMany({
    include: { events: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  }),
);

await app.listen({ port, host: "127.0.0.1" });
console.warn(`e2e API listening on http://127.0.0.1:${port}`);
