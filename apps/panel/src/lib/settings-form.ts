import {
  BusinessSettingsSchema,
  type BusinessResponse,
  type BusinessSettings,
} from "@puente/shared";

/** Form values as the inputs hold them (lists as one item per line, numbers as text). */
export interface SettingsForm {
  name: string;
  kind: string;
  botName: string;
  voice: "tu" | "vos";
  brandColor: string;
  whatsappNumber: string;
  /** Empty = the main number at all hours. */
  offHoursWhatsappNumber: string;
  notifyEmail: string;
  timezone: string;
  days: number[];
  from: string;
  to: string;
  offHoursMessage: string;
  greeting: string;
  suggestions: string;
  sensitiveTopics: string;
  allowedDomains: string;
  maxMessagesPerConv: string;
  dailyMessageCap: string;
  active: boolean;
}

export type FormErrors = Partial<Record<keyof SettingsForm, string>>;

const lines = (text: string) =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Phone as typed ("+595 975 617400") → digits only. */
const digits = (phone: string) => phone.replace(/[\s+()-]/g, "");

export function toForm(b: BusinessResponse): SettingsForm {
  return {
    name: b.name,
    kind: b.kind,
    botName: b.botName,
    voice: b.voice,
    brandColor: b.brandColor,
    whatsappNumber: b.whatsappNumber,
    offHoursWhatsappNumber: b.offHoursWhatsappNumber ?? "",
    notifyEmail: b.notifyEmail,
    timezone: b.timezone,
    days: b.hours.days,
    from: b.hours.from,
    to: b.hours.to,
    offHoursMessage: b.offHoursMessage,
    greeting: b.greeting,
    suggestions: b.suggestions.join("\n"),
    sensitiveTopics: b.sensitiveTopics.join("\n"),
    allowedDomains: b.allowedDomains.join("\n"),
    maxMessagesPerConv: String(b.maxMessagesPerConv),
    dailyMessageCap: String(b.dailyMessageCap),
    active: b.active,
  };
}

/** Maps a schema issue path back to the form field that shows it. */
function fieldOf(path: PropertyKey[]): keyof SettingsForm {
  const [head, sub] = path;
  if (head === "hours") return sub === "days" ? "days" : sub === "from" ? "from" : "to";
  return head as keyof SettingsForm;
}

/** Validates with the same schema as the API so the form never sends what it would reject. */
export function fromForm(
  form: SettingsForm,
): { ok: true; settings: BusinessSettings } | { ok: false; errors: FormErrors } {
  const candidate = {
    name: form.name,
    kind: form.kind,
    botName: form.botName,
    voice: form.voice,
    brandColor: form.brandColor.trim(),
    whatsappNumber: digits(form.whatsappNumber),
    offHoursWhatsappNumber: digits(form.offHoursWhatsappNumber) || null,
    notifyEmail: form.notifyEmail.trim(),
    timezone: form.timezone.trim(),
    hours: { days: [...form.days].sort((a, b) => a - b), from: form.from, to: form.to },
    offHoursMessage: form.offHoursMessage,
    greeting: form.greeting,
    suggestions: lines(form.suggestions),
    sensitiveTopics: lines(form.sensitiveTopics),
    allowedDomains: lines(form.allowedDomains),
    maxMessagesPerConv: Number(form.maxMessagesPerConv),
    dailyMessageCap: Number(form.dailyMessageCap),
    active: form.active,
  };
  const result = BusinessSettingsSchema.safeParse(candidate);
  if (result.success) return { ok: true, settings: result.data };
  const errors: FormErrors = {};
  for (const issue of result.error.issues) {
    const field = fieldOf(issue.path);
    errors[field] ??=
      issue.message.startsWith("Invalid") || issue.message.startsWith("Too")
        ? "Valor inválido"
        : issue.message;
  }
  return { ok: false, errors };
}
