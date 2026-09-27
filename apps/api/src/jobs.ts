import type { FastifyBaseLogger } from "fastify";
import type { Db } from "./db/client";
import { LlmHealthMonitor } from "./services/llm-health";
import type { Mailer } from "./services/mailer";
import { runRetention } from "./services/retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const HEALTH_CHECK_MS = 5 * 60 * 1000;

export interface JobsDeps {
  db: Db;
  mailer: Mailer;
  log: FastifyBaseLogger;
  retentionDays: number;
  alertEmail: string;
}

/** In-process schedule (single instance). Returns a stop function for graceful shutdown. */
export function startJobs(deps: JobsDeps): () => void {
  const monitor = new LlmHealthMonitor(deps.db, deps.mailer, deps.alertEmail, deps.log);

  const retention = () =>
    runRetention(deps.db, deps.retentionDays, new Date())
      .then((r) => deps.log.info({ job: "retention", ...r }, "retention done"))
      .catch((err: unknown) =>
        deps.log.error({ job: "retention", err: String(err) }, "retention failed"),
      );
  const health = () =>
    monitor
      .check(new Date())
      .catch((err: unknown) =>
        deps.log.error({ job: "llm_health", err: String(err) }, "llm health check failed"),
      );

  void retention();
  const timers = [
    setInterval(() => void retention(), DAY_MS),
    setInterval(() => void health(), HEALTH_CHECK_MS),
  ];
  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}
