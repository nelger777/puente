import type { BusinessHours } from "./schemas/business";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0 = Sunday
  minutes: number; // minutes since local midnight
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Whether `now` falls inside the business opening hours, evaluated in its time zone. */
export function isInHours(hours: BusinessHours, timeZone: string, now: Date): boolean {
  const local = zonedParts(now, timeZone);
  if (!hours.days.includes(local.weekday)) return false;
  return local.minutes >= toMinutes(hours.from) && local.minutes < toMinutes(hours.to);
}

/** UTC instant of the most recent local midnight in `timeZone`. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const local = zonedParts(now, timeZone);
  const localMidnightAsUtc = Date.UTC(local.year, local.month - 1, local.day);
  // Offset of the zone at that moment (handles DST transitions well enough for daily caps).
  const probe = zonedParts(new Date(localMidnightAsUtc), timeZone);
  const probeAsUtc = Date.UTC(probe.year, probe.month - 1, probe.day) + probe.minutes * 60_000;
  return new Date(localMidnightAsUtc - (probeAsUtc - localMidnightAsUtc));
}

/** Calendar month of `date` in `timeZone`, as "YYYY-MM" (usage is counted per local month). */
export function localMonth(date: Date, timeZone: string): string {
  const local = zonedParts(date, timeZone);
  return `${local.year}-${String(local.month).padStart(2, "0")}`;
}
