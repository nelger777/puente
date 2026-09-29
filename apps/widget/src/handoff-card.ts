import { h } from "./dom";
import type { HandoffItem } from "./storage";
import type { WidgetTexts } from "./texts";

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
  t: WidgetTexts,
): HTMLElement {
  const { handoff } = item;
  const body = h("div", { class: "card-body" });

  if (!handoff.inHours && handoff.offHoursMessage) {
    body.append(h("p", { class: "warn" }, handoff.offHoursMessage));
  }
  body.append(
    h("p", { class: "hint" }, t.cardHint),
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
        item.whatsappOpened ? t.whatsappAgain : t.whatsappButton,
      ),
    );
  }

  if (item.contactPhone) {
    body.append(h("p", { class: "done" }, t.contactDone(item.contactPhone)));
  } else {
    if (item.whatsappOpened) {
      body.append(h("p", { class: "done" }, t.whatsappDone));
    }
    body.append(contactForm(item, businessName, handlers, t));
  }

  return h(
    "section",
    { class: "card", "aria-label": `Derivación ${handoff.code}` },
    h("div", { class: "card-head" }, h("span", {}, t.cardTitle), h("span", {}, handoff.code)),
    body,
  );
}

function contactForm(
  item: HandoffItem,
  businessName: string,
  handlers: CardHandlers,
  t: WidgetTexts,
): HTMLElement {
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
  const submit = h("button", { type: "submit" }, t.contactSubmit);

  const form = h(
    "form",
    {
      novalidate: true,
      onsubmit: (event: Event) => {
        event.preventDefault();
        error.textContent = "";
        if (!isValidPhone(phone.value)) {
          error.textContent = t.phoneInvalid;
          phone.focus();
          return;
        }
        if (!consent.checked) {
          error.textContent = t.consentMissing;
          consent.focus();
          return;
        }
        submit.disabled = true;
        handlers.onContact(item, name.value.trim(), phone.value.trim()).catch(() => {
          error.textContent = t.contactFailed;
          submit.disabled = false;
        });
      },
    },
    h("label", { for: `pn-${code}` }, t.contactName),
    name,
    h("label", { for: `pp-${code}` }, t.contactPhone),
    phone,
    h("label", { class: "consent", for: `pc-${code}` }, consent, t.consent(businessName)),
    error,
    submit,
  );

  return h("details", {}, h("summary", {}, t.contactSummary), form);
}
