import type { Voice } from "@puente/shared";

/** Every customer-facing string of the widget, per form of address ("tú" or "vos"). */
export interface WidgetTexts {
  placeholder: string;
  send: string;
  askForPerson: string;
  inHours: string;
  offHours: string;
  typing: (botName: string) => string;
  rateLimited: string;
  sendFailed: string;
  remaining: (n: number) => string;
  limitReached: string;
  cardTitle: string;
  cardHint: string;
  whatsappButton: string;
  whatsappAgain: string;
  whatsappDone: string;
  contactSummary: string;
  contactName: string;
  contactPhone: string;
  consent: (businessName: string) => string;
  contactSubmit: string;
  contactDone: (phone: string) => string;
  phoneInvalid: string;
  consentMissing: string;
  contactFailed: string;
}

const remaining = (n: number) =>
  `Quedan ${n} ${n === 1 ? "mensaje" : "mensajes"} en esta conversación. Después te conecto con una persona del equipo.`;

const TU: WidgetTexts = {
  placeholder: "Escribe tu consulta…",
  send: "Enviar",
  askForPerson: "Quiero hablar con una persona por WhatsApp",
  inHours: "Equipo en horario de atención",
  offHours: "Equipo fuera de horario",
  typing: (bot) => `${bot} está escribiendo…`,
  rateLimited: "Estás enviando muchos mensajes. Espera un momento y vuelve a intentar.",
  sendFailed: "No pudimos enviar tu mensaje. Revisa tu conexión e intenta de nuevo.",
  remaining,
  limitReached:
    "Llegaste al límite de mensajes. Si escribes de nuevo, te conecto con una persona del equipo.",
  cardTitle: "Te conectamos con una persona",
  cardHint: "Resumen de tu consulta. Ya queda escrito en WhatsApp: solo tienes que enviarlo.",
  whatsappButton: "Continuar por WhatsApp con un asesor",
  whatsappAgain: "Abrir WhatsApp de nuevo",
  whatsappDone: "Listo. Continúa la conversación en WhatsApp.",
  contactSummary: "¿Prefieres que te contacten?",
  contactName: "Tu nombre (opcional)",
  contactPhone: "Tu teléfono",
  consent: (name) => `Acepto que ${name} use estos datos solo para contactarme por esta consulta.`,
  contactSubmit: "Que me contacten",
  contactDone: (phone) => `Listo. El equipo te contactará al ${phone}.`,
  phoneInvalid: "Escribe un teléfono válido.",
  consentMissing: "Necesitamos tu autorización para contactarte.",
  contactFailed: "No pudimos enviar tus datos. Intenta de nuevo.",
};

const VOS: WidgetTexts = {
  ...TU,
  placeholder: "Escribí tu consulta…",
  rateLimited: "Estás enviando muchos mensajes. Esperá un momento y volvé a intentar.",
  sendFailed: "No pudimos enviar tu mensaje. Revisá tu conexión e intentá de nuevo.",
  limitReached:
    "Llegaste al límite de mensajes. Si escribís de nuevo, te conecto con una persona del equipo.",
  cardHint: "Resumen de tu consulta. Ya queda escrito en WhatsApp: solo tenés que enviarlo.",
  whatsappDone: "Listo. Continuá la conversación en WhatsApp.",
  contactSummary: "¿Preferís que te contacten?",
  phoneInvalid: "Escribí un teléfono válido.",
  contactFailed: "No pudimos enviar tus datos. Intentá de nuevo.",
};

export function textsFor(voice: Voice | undefined): WidgetTexts {
  return voice === "vos" ? VOS : TU;
}
