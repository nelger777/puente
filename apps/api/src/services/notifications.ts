import { HANDOFF_REASON_LABELS } from "@puente/shared";
import type { Db } from "../db/client";
import type { Business, Handoff } from "../generated/prisma/client";
import type { BackgroundTasks } from "../lib/background";
import { newId } from "../lib/ids";
import type { Mailer } from "./mailer";

type NotifyBusiness = Pick<Business, "name" | "notifyEmail">;

/**
 * Team e-mails (docs/DECISIONS.md: on a new case and on a contact request, never on updates).
 * Sent in the background; an `email_sent` event is recorded once delivered.
 */
export class Notifier {
  constructor(
    private readonly db: Db,
    private readonly mailer: Mailer,
    private readonly background: BackgroundTasks,
    private readonly panelUrl: string,
  ) {}

  handoffCreated(business: NotifyBusiness, handoff: Handoff): void {
    const lines = [
      `Nueva derivación ${handoff.code} en ${business.name}.`,
      "",
      `Motivo: ${HANDOFF_REASON_LABELS[handoff.reason]}`,
      `Recibida ${handoff.openedInHours ? "en horario" : "fuera de horario"}.`,
      "",
      `Resumen: ${handoff.summary}`,
      "",
      `Ver el caso: ${this.caseUrl(handoff.code)}`,
    ];
    this.send(handoff, {
      to: business.notifyEmail,
      subject: `Nueva derivación ${handoff.code} · ${HANDOFF_REASON_LABELS[handoff.reason]}`,
      text: lines.join("\n"),
    });
  }

  contactRequested(business: NotifyBusiness, handoff: Handoff): void {
    const lines = [
      `El cliente del caso ${handoff.code} pidió que lo contacten.`,
      "",
      `Nombre: ${handoff.contactName ?? "(no lo indicó)"}`,
      `Teléfono: ${handoff.contactPhone ?? ""}`,
      "",
      `Resumen: ${handoff.summary}`,
      "",
      `Ver el caso: ${this.caseUrl(handoff.code)}`,
    ];
    this.send(handoff, {
      to: business.notifyEmail,
      subject: `Pedido de contacto ${handoff.code}`,
      text: lines.join("\n"),
    });
  }

  private caseUrl(code: string): string {
    return `${this.panelUrl.replace(/\/$/, "")}/derivaciones/${code}`;
  }

  private send(handoff: Handoff, message: Parameters<Mailer["send"]>[0]): void {
    this.background.run("handoff_email", async () => {
      await this.mailer.send(message);
      await this.db.handoffEvent.create({
        data: { id: newId("hev"), handoffId: handoff.id, type: "email_sent", actor: "system" },
      });
    });
  }
}
