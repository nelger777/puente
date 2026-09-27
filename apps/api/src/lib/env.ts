import { z } from "zod";

const flag = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  /** Behind a reverse proxy, take the client IP from X-Forwarded-For (rate limits). */
  TRUST_PROXY: flag,
  DATABASE_URL: z.url(),
  ANTHROPIC_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  /** USD per million tokens, for the cost estimate (defaults: Claude Haiku 4.5). */
  LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().nonnegative().default(1),
  LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().nonnegative().default(5),
  SMTP_URL: z.string().default("smtp://localhost:1026"),
  MAIL_FROM: z.string().default("Puente <no-reply@puente.local>"),
  /** Who receives platform alerts (LLM failure rate). Empty: log only. */
  ALERT_EMAIL: z.union([z.literal(""), z.email()]).default(""),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_API_URL: z.url(),
  WIDGET_CDN_URL: z.url(),
  PANEL_URL: z.url(),
  RETENTION_DAYS: z.coerce.number().int().positive().default(90),
});
export type Env = z.infer<typeof EnvSchema>;

/** The placeholder shipped in .env.example must never reach production. */
const EXAMPLE_SECRET_MARKER = "change-me";

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment variables: ${fields}`);
  }
  const env = result.data;
  if (env.NODE_ENV === "production") {
    if (env.SESSION_SECRET.includes(EXAMPLE_SECRET_MARKER)) {
      throw new Error("SESSION_SECRET still has the example value; generate a random one");
    }
    if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required in production");
  }
  return env;
}
