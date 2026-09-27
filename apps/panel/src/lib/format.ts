import { HANDOFF_REASON_LABELS, type HandoffReason } from "@puente/shared";

export const reasonLabel = (reason: HandoffReason) => HANDOFF_REASON_LABELS[reason];

const EVENT_LABELS: Record<string, string> = {
  created: "Derivación creada",
  updated: "El cliente volvió a pedir atención",
  whatsapp_opened: "El cliente abrió WhatsApp",
  contact_requested: "Pidió que lo contacten",
  resolved: "Marcada como atendida",
  reopened: "Reabierta",
  email_sent: "Aviso enviado por correo",
};

export const eventLabel = (type: string) => EVENT_LABELS[type] ?? type;

const dateFormat = new Intl.DateTimeFormat("es", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatDate = (iso: string) => dateFormat.format(new Date(iso));

export const formatNumber = (n: number) => n.toLocaleString("es");

/** Small amounts need more decimals: a conversation usually costs fractions of a cent. */
export const formatUsd = (n: number) =>
  `US$ ${n.toLocaleString("es", { minimumFractionDigits: n > 0 && n < 0.01 ? 4 : 2, maximumFractionDigits: 4 })}`;

/** wa.me needs digits only (with country code for it to open the right chat). */
export const waChatUrl = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/** Reasons that usually need a careful answer are highlighted. */
export const isSensitiveReason = (reason: HandoffReason) =>
  reason === "SENSITIVE_TOPIC" || reason === "FRUSTRATION";
