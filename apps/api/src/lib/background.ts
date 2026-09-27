import type { FastifyBaseLogger } from "fastify";

/** Fire-and-forget work that must not block a response. Tests can await it with drain(). */
export class BackgroundTasks {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly log: FastifyBaseLogger) {}

  run(name: string, task: () => Promise<void>): void {
    const p = task()
      .catch((err: unknown) => {
        this.log.error(
          { task: name, err: err instanceof Error ? err.message : String(err) },
          "background task failed",
        );
      })
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending);
  }
}
