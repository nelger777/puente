import { BusinessHoursSchema, type BusinessHours } from "@puente/shared";
import type { Business } from "../generated/prisma/client";

/** Opening hours stored as JSON; invalid data means "never open" instead of crashing. */
export function businessHours(business: Pick<Business, "hours">): BusinessHours {
  const parsed = BusinessHoursSchema.safeParse(business.hours);
  return parsed.success ? parsed.data : { days: [], from: "00:00", to: "00:01" };
}
