import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client";
import type { Mailer } from "./mailer";

export const ALERT_WINDOW_MS = 60 * 60 * 1000;
export const ALERT_THRESHOLD = 0.05;
export const ALERT_MIN_ATTEMPTS = 20;

export interface LlmHealth {
  attempts: number;
  failures: number;
  rate: number;
}

/**
 * Share of replies in the last hour that tried the LLM and ended in TECHNICAL_FAILURE,
 * across all businesses (an outage or a bad API key affects everyone).
 */
export async function measureLlmHealth(db: Db, now: Date): Promise<LlmHealth> {
  const since = new Date(now.getTime() - ALERT_WINDOW_MS);
  const window = { role: "ASSISTANT" as const, createdAt: { gte: since } };
  const [ok, failures] = await Promise.all([
    db.message.count({ where: { ...window, engine: "llm" } }),
    db.message.count({ where: { ...window, llmError: { not: null } } }),
  ]);
  const attempts = ok + failures;
  return { attempts, failures, rate: attempts ? failures / attempts : 0 };
}

export function shouldAlert(health: LlmHealth): boolean {
  return health.attempts >= ALERT_MIN_ATTEMPTS && health.rate > ALERT_THRESHOLD;
}

/** Checks periodically and alerts at most once per window. */
export class LlmHealthMonitor {
  private lastAlertAt = 0;

  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly alertEmail: string,
    private readonly log: FastifyBaseLogger,
  ) {}

  async check(now: Date): Promise<LlmHealth & { alerted: boolean }> {
    const health = await measureLlmHealth(this.db, now);
    const quiet = now.getTime() - this.lastAlertAt < ALERT_WINDOW_MS;
    if (!shouldAlert(health) || quiet) return { ...health, alerted: false };

    this.lastAlertAt = now.getTime();
    const pct = (health.rate * 100).toFixed(1);
    this.log.error(
      { ...health, alert: "llm_failure_rate" },
      `LLM failure rate ${pct}% in the last hour`,
    );
    if (this.alertEmail) {
      await this.mailer.send({
        to: this.alertEmail,
        subject: `[Puente] IA con fallas: ${pct}% en la última hora`,
        text: [
          `En la última hora, ${health.failures} de ${health.attempts} respuestas no pudieron usar la IA`,
          `(${pct}%, umbral ${ALERT_THRESHOLD * 100}%). Los clientes fueron derivados al equipo.`,
          "",
          "Revisa ANTHROPIC_API_KEY, el estado de la API de Anthropic y los logs del servidor.",
        ].join("\n"),
      });
    }
    return { ...health, alerted: true };
  }
}
