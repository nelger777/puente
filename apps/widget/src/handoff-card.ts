import { h } from "./dom";
import type { HandoffItem } from "./storage";

export interface CardHandlers {
  onWhatsApp(item: HandoffItem): void;
  /** Resolves when the request is done; rejects to show an error in the form. */
  onContact(item: HandoffItem, name: string, phone: string): Promise<void>;
}

const WA_LINK = /^https:\/\/wa\.me\/\d+\?text=/;

/** Same rule as PhoneSchema in @puente/shared. */
export function isValidPhone(value: string): boolean {
  const v = value.trim();
  return /^\+?[\d\s().-]{7,20}$/.test(v) && v.replace(/\D/g, "").length >= 7;
}

/** Handoff card (docs/SPEC.md §6). Never shrinks inside the message list. */
export function renderHandoffCard(
  item: HandoffItem,
  businessName: string,
  handlers: CardHandlers,
): HTMLElement {
  const { handoff } = item;
  const body = h("div", { class: "card-body" });

  if (!handoff.inHours && handoff.offHoursMessage) {
    body.append(h("p", { class: "warn" }, handoff.offHoursMessage));
  }
  body.append(
    h(
      "p",
      { class: "hint" },
      "Resumen de tu consulta. Ya queda escrito en WhatsApp: solo tienes que enviarlo.",
    ),
    h("div", { class: "preview" }, h("p", {}, handoff.waMessage)),
  );

  if (WA_LINK.test(handoff.waUrl)) {
    body.append(
      h(
        "a",
        {
          class: "wa-button",
          href: handoff.waUrl,
          target: "_blank",
          rel: "noopener noreferrer",
          onclick: () => handlers.onWhatsApp(item),
        },
        item.whatsappOpened ? "Abrir WhatsApp de nuevo" : "Continuar por WhatsApp con un asesor",
      ),
    );
  }

  if (item.contactPhone) {
    body.append(
      h("p", { class: "done" }, `Listo. El equipo te contactará al ${item.contactPhone}.`),
    );
  } else {
    if (item.whatsappOpened) {
      body.append(h("p", { class: "done" }, "Listo. Continúa la conversación en WhatsApp."));
    }
    body.append(contactForm(item, businessName, handlers));
  }

  return h(
    "section",
    { class: "card", "aria-label": `Derivación ${handoff.code}` },
    h(
      "div",
      { class: "card-head" },
      h("span", {}, "Te conectamos con una persona"),
      h("span", {}, handoff.code),
    ),
    body,
  );
}

function contactForm(item: HandoffItem, businessName: string, handlers: CardHandlers): HTMLElement {
  const code = item.handoff.code;
  const name = h("input", { type: "text", id: `pn-${code}`, autocomplete: "name", maxlength: 80 });
  const phone = h("input", {
    type: "tel",
    id: `pp-${code}`,
    autocomplete: "tel",
    required: true,
    maxlength: 20,
  });
  const consent = h("input", { type: "checkbox", id: `pc-${code}`, required: true });
  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { type: "submit" }, "Que me contacten");

  const form = h(
    "form",
    {
      novalidate: true,
      onsubmit: (event: Event) => {
        event.preventDefault();
        error.textContent = "";
        if (!isValidPhone(phone.value)) {
          error.textContent = "Escribe un teléfono válido.";
          phone.focus();
          return;
        }
        if (!consent.checked) {
          error.textContent = "Necesitamos tu autorización para contactarte.";
          consent.focus();
          return;
        }
        submit.disabled = true;
        handlers.onContact(item, name.value.trim(), phone.value.trim()).catch(() => {
          error.textContent = "No pudimos enviar tus datos. Intenta de nuevo.";
          submit.disabled = false;
        });
      },
    },
    h("label", { for: `pn-${code}` }, "Tu nombre (opcional)"),
    name,
    h("label", { for: `pp-${code}` }, "Tu teléfono"),
    phone,
    h(
      "label",
      { class: "consent", for: `pc-${code}` },
      consent,
      `Acepto que ${businessName} use estos datos solo para contactarme por esta consulta.`,
    ),
    error,
    submit,
  );

  return h("details", {}, h("summary", {}, "¿Prefieres que te contacten?"), form);
}
