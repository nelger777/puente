import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { smtpMailer } from "../src/services/mailer";

const smtpUrl = process.env.SMTP_URL ?? "smtp://localhost:1026";
const mailpitUrl = process.env.MAILPIT_URL ?? "http://localhost:8026";

interface MailpitSearch {
  messages: { Subject: string; To: { Address: string }[] }[];
}

describe("SMTP mailer (mailpit)", () => {
  it("delivers the e-mail to the SMTP server", async () => {
    const subject = `Prueba ${randomUUID()}`;
    await smtpMailer(smtpUrl, "Puente <no-reply@puente.local>").send({
      to: "equipo@opticamirador.com",
      subject,
      text: "Nueva derivación de prueba.",
    });

    let found: MailpitSearch["messages"] = [];
    for (let i = 0; i < 20 && found.length === 0; i++) {
      const res = await fetch(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`,
      );
      found = ((await res.json()) as MailpitSearch).messages;
      if (found.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    expect(found).toHaveLength(1);
    expect(found[0]?.To[0]?.Address).toBe("equipo@opticamirador.com");
  });
});
