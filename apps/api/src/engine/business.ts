import { BusinessHoursSchema, VoiceSchema, type BusinessHours, type Voice } from "@puente/shared";
import type { Business } from "../generated/prisma/client";

/** Opening hours stored as JSON; invalid data means "never open" instead of crashing. */
export function businessHours(business: Pick<Business, "hours">): BusinessHours {
  const parsed = BusinessHoursSchema.safeParse(business.hours);
  return parsed.success ? parsed.data : { days: [], from: "00:00", to: "00:01" };
}

export function businessVoice(business: Pick<Business, "voice">): Voice {
  return VoiceSchema.catch("tu").parse(business.voice);
}

/** WhatsApp number for a handoff: the off-hours one outside opening hours, when configured. */
export function handoffNumber(
  business: Pick<Business, "whatsappNumber" | "offHoursWhatsappNumber">,
  inHours: boolean,
): string {
  return inHours
    ? business.whatsappNumber
    : (business.offHoursWhatsappNumber ?? business.whatsappNumber);
}
