import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.url(),
  ANTHROPIC_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  SMTP_URL: z.string().default("smtp://localhost:1026"),
  MAIL_FROM: z.string().default("Puente <no-reply@puente.local>"),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_API_URL: z.url(),
  WIDGET_CDN_URL: z.url(),
  PANEL_URL: z.url(),
  RETENTION_DAYS: z.coerce.number().int().positive().default(90),
});
export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment variables: ${fields}`);
  }
  return result.data;
}
