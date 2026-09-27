import { buildApp } from "./app";
import { createDb } from "./db/client";
import { anthropicTransport } from "./engine/llm";
import { startJobs } from "./jobs";
import { parseEnv } from "./lib/env";
import { loadRootEnv } from "./lib/load-env";
import { smtpMailer } from "./services/mailer";

loadRootEnv();
const env = parseEnv();

const db = createDb(env.DATABASE_URL);
const app = buildApp(
  {
    db,
    env,
    llm: anthropicTransport(env.ANTHROPIC_API_KEY),
    mailer: smtpMailer(env.SMTP_URL, env.MAIL_FROM),
  },
  {
    trustProxy: env.TRUST_PROXY,
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      // Never log message contents, phones or credentials (bodies are not logged at all).
      redact: ["req.headers.cookie", "req.headers.authorization"],
    },
  },
);

const stopJobs = startJobs({
  db,
  mailer: smtpMailer(env.SMTP_URL, env.MAIL_FROM),
  log: app.log,
  retentionDays: env.RETENTION_DAYS,
  alertEmail: env.ALERT_EMAIL,
});

if (!env.ANTHROPIC_API_KEY) {
  app.log.warn("ANTHROPIC_API_KEY is empty: every chat will hand off with TECHNICAL_FAILURE");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopJobs();
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
