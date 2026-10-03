import type { Db } from "../db/client";
import type { Business } from "../generated/prisma/client";
import type { BackgroundTasks } from "../lib/background";
import { localMonth } from "../lib/time";
import type { Mailer } from "./mailer";

/** Share of the monthly quota that triggers the early warning. */
export const USAGE_WARNING_SHARE = 0.8;

export type UsageAlert = "warning" | "reached";

type UsageBusiness = Pick<
  Business,
  "id" | "name" | "timezone" | "notifyEmail" | "monthlyConversationQuota"
>;

interface UsageRow {
  conversations: number;
  alert80SentAt: Date | null;
  alert100SentAt: Date | null;
}

export interface RecordedUsage {
  month: string;
  conversations: number;
  alert: UsageAlert | null;
}

/**
 * Counts one conversation in the business's current local month and claims the alert it
 * crosses, if any. Each alert is claimed at most once per month (a conditional update, so two
 * concurrent conversations cannot both send it). Over the quota nothing is blocked.
 */
export async function recordConversation(
  db: Db,
  business: UsageBusiness,
  now: Date,
): Promise<RecordedUsage> {
  const month = localMonth(now, business.timezone);
  const rows = await db.$queryRaw<UsageRow[]>`
    INSERT INTO "UsageMonth" ("businessId", "month", "conversations", "updatedAt")
    VALUES (${business.id}, ${month}, 1, ${now})
    ON CONFLICT ("businessId", "month")
    DO UPDATE SET "conversations" = "UsageMonth"."conversations" + 1, "updatedAt" = ${now}
    RETURNING "conversations", "alert80SentAt", "alert100SentAt"`;
  const row = rows[0];
  if (!row) throw new Error("usage upsert returned no row");
  const { conversations } = row;
  const quota = business.monthlyConversationQuota;
  if (!quota) return { month, conversations, alert: null };

  const key = { businessId: business.id, month };
  if (conversations >= quota && !row.alert100SentAt) {
    // Reaching the cap also settles the warning, so it never arrives after "reached".
    const claimed = await db.usageMonth.updateMany({
      where: { ...key, alert100SentAt: null },
      data: { alert100SentAt: now, alert80SentAt: row.alert80SentAt ?? now },
    });
    if (claimed.count === 1) return { month, conversations, alert: "reached" };
  } else if (conversations >= Math.ceil(quota * USAGE_WARNING_SHARE) && !row.alert80SentAt) {
    const claimed = await db.usageMonth.updateMany({
      where: { ...key, alert80SentAt: null },
      data: { alert80SentAt: now },
    });
    if (claimed.count === 1) return { month, conversations, alert: "warning" };
  }
  return { month, conversations, alert: null };
}

const monthName = new Intl.DateTimeFormat("es", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-10" → "octubre de 2026". */
export function formatMonth(month: string): string {
  const [year = 0, mm = 1] = month.split("-").map(Number);
  return monthName.format(new Date(Date.UTC(year, mm - 1, 1)));
}

/** Counts conversations as they start and e-mails the team and the operator at 80 % and 100 %. */
export class UsageMeter {
  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly background: BackgroundTasks,
    private readonly alertEmail: string,
    private readonly panelUrl: string,
  ) {}

  conversationStarted(business: UsageBusiness, now: Date): void {
    this.background.run("usage_count", async () => {
      const usage = await recordConversation(this.db, business, now);
      if (usage.alert) await this.sendAlert(business, usage.alert, usage);
    });
  }

  private async sendAlert(
    business: UsageBusiness,
    alert: UsageAlert,
    usage: RecordedUsage,
  ): Promise<void> {
    const quota = business.monthlyConversationQuota ?? 0;
    const month = formatMonth(usage.month);
    const n = (x: number) => x.toLocaleString("es");
    const subject =
      alert === "reached"
        ? `[Puente] ${business.name}: se alcanzó el plan de conversaciones de ${month}`
        : `[Puente] ${business.name}: 80 % del plan de conversaciones de ${month}`;
    const lines = [
      alert === "reached"
        ? `${business.name} llegó a las ${n(quota)} conversaciones incluidas en su plan de ${month}.`
        : `${business.name} lleva ${n(usage.conversations)} de las ${n(quota)} conversaciones incluidas en su plan de ${month}.`,
      "",
      alert === "reached"
        ? "El asistente sigue respondiendo con normalidad. Las conversaciones adicionales se facturan según el plan contratado."
        : "El asistente sigue respondiendo con normalidad. Si se supera el plan, las conversaciones adicionales se facturan según lo contratado.",
      "",
      `Ver el uso en el panel: ${this.panelUrl.replace(/\/$/, "")}/`,
    ];
    const recipients = [...new Set([business.notifyEmail, this.alertEmail].filter(Boolean))];
    for (const to of recipients) {
      await this.mailer.send({ to, subject, text: lines.join("\n") });
    }
  }
}
