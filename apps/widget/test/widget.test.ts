import type { ChatHandoff, ChatResponse, WidgetConfigResponse } from "@puente/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../src/api";
import { readSettings } from "../src/config";
import { textColorFor } from "../src/dom";
import { isValidPhone, renderHandoffCard } from "../src/handoff-card";
import { linkify } from "../src/linkify";
import { StateStore, type HandoffItem } from "../src/storage";
import { textsFor } from "../src/texts";
import { ASK_FOR_PERSON, ChatWidget } from "../src/widget";

const TU = textsFor("tu");

const HANDOFF: ChatHandoff = {
  code: "DER-4821",
  reason: "EXPLICIT_REQUEST",
  waMessage: "Hola, quiero hablar con alguien.",
  waUrl: "https://wa.me/595981000000?text=Hola%0A%0A(Caso%20DER-4821)",
  inHours: false,
  offHoursMessage: "Te responderán apenas abran.",
};

const CONFIG: WidgetConfigResponse = {
  businessName: "Óptica Mirador",
  botName: "Luz",
  voice: "tu",
  brandColor: "#1F5FBF",
  greeting: "¡Hola! Soy Luz.",
  suggestions: ["¿Cuál es el horario?"],
  inHours: true,
};

function reply(overrides: Partial<ChatResponse> = {}): ChatResponse {
  return {
    conversationId: "conv_1",
    conversationToken: "t".repeat(43),
    reply: "Atendemos de 8 a 18.",
    quickReplies: [],
    remainingMessages: 10,
    handoff: null,
    ...overrides,
  };
}

function mount(
  api: Partial<ConstructorParameters<typeof ChatWidget>[2]> = {},
  config: WidgetConfigResponse = CONFIG,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  const fullApi = {
    chat: vi.fn(() => Promise.resolve(reply())),
    requestContact: vi.fn(() => Promise.resolve()),
    trackEvent: vi.fn(() => Promise.resolve()),
    ...api,
  };
  const widget = new ChatWidget(root, config, fullApi, new StateStore("pk_test"));
  return { widget, root, api: fullApi };
}

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("settings", () => {
  it("reads the key and an optional API override", () => {
    const script = document.createElement("script");
    expect(readSettings(script)).toBeNull();
    script.dataset.key = "pk_abc";
    expect(readSettings(script)).toEqual({ key: "pk_abc", apiUrl: "http://localhost:3000" });
    script.dataset.api = "https://api.example.com/";
    expect(readSettings(script)?.apiUrl).toBe("https://api.example.com");
  });

  it("uses the origin that served the bundle in production", () => {
    const script = document.createElement("script");
    script.dataset.key = "pk_abc";
    script.src = "https://puente.example.com/widget/v1.js";
    expect(readSettings(script, false)?.apiUrl).toBe("https://puente.example.com");
    expect(readSettings(script, true)?.apiUrl).toBe("http://localhost:3000");
  });
});

describe("StateStore", () => {
  it("survives a storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    } as unknown as Storage;
    const store = new StateStore("pk_x", () => broken);
    const state = store.load();
    expect(state.visitorId).toMatch(/^v_[0-9a-f]{24}$/);
    expect(() => store.save(state)).not.toThrow();
  });

  it("ignores corrupted data and keeps only the last 50 items", () => {
    localStorage.setItem("puente:pk_x", "{not json");
    const store = new StateStore("pk_x");
    const state = store.load();
    expect(state.items).toEqual([]);
    state.items = Array.from({ length: 60 }, (_, i) => ({ kind: "user" as const, text: `m${i}` }));
    store.save(state);
    const saved = new StateStore("pk_x").load();
    expect(saved.items).toHaveLength(50);
    expect(saved.visitorId).toBe(state.visitorId);
  });
});

describe("handoff card", () => {
  const item = (): HandoffItem => ({
    kind: "handoff",
    handoff: HANDOFF,
    whatsappOpened: false,
    contactPhone: null,
  });

  it("shows the off-hours notice, the message preview and the WhatsApp button", () => {
    const card = renderHandoffCard(
      item(),
      "Óptica Mirador",
      { onWhatsApp: vi.fn(), onContact: vi.fn() },
      TU,
    );
    expect(card.textContent).toContain("Te conectamos con una persona");
    expect(card.textContent).toContain("DER-4821");
    expect(card.textContent).toContain("Te responderán apenas abran.");
    expect(card.textContent).toContain("Ya queda escrito en WhatsApp: solo tienes que enviarlo.");
    const link = card.querySelector("a");
    expect(link?.getAttribute("href")).toBe(HANDOFF.waUrl);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.textContent).toBe("Continuar por WhatsApp con un asesor");
  });

  it("never renders a link that is not wa.me", () => {
    const bad = { ...item(), handoff: { ...HANDOFF, waUrl: "javascript:alert(1)" } };
    const card = renderHandoffCard(bad, "X", { onWhatsApp: vi.fn(), onContact: vi.fn() }, TU);
    expect(card.querySelector("a")).toBeNull();
  });

  it("requires phone and consent before sending contact data", async () => {
    const onContact = vi.fn(() => Promise.resolve());
    const card = renderHandoffCard(
      item(),
      "Óptica Mirador",
      { onWhatsApp: vi.fn(), onContact },
      TU,
    );
    const form = card.querySelector("form");
    const phone = card.querySelector<HTMLInputElement>("input[type=tel]");
    const consent = card.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (!form || !phone || !consent) throw new Error("form not rendered");

    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onContact).not.toHaveBeenCalled();
    expect(card.textContent).toContain("Escribe un teléfono válido.");

    phone.value = "0981 123 456";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(onContact).not.toHaveBeenCalled();
    expect(card.textContent).toContain("Necesitamos tu autorización");

    consent.checked = true;
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await Promise.resolve();
    expect(onContact).toHaveBeenCalledWith(expect.anything(), "", "0981 123 456");
  });

  it("validates phones like the API", () => {
    expect(isValidPhone("+595 981 123-456")).toBe(true);
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("abc1234567")).toBe(false);
  });
});

describe("ChatWidget", () => {
  it("renders greeting and suggestions, and sends a message", async () => {
    const { root, api, widget } = mount();
    expect(root.textContent).toContain("¡Hola! Soy Luz.");
    expect(root.textContent).toContain("¿Cuál es el horario?");
    expect(root.querySelector("[role=log]")?.getAttribute("aria-live")).toBe("polite");

    await widget.send("¿A qué hora abren?");
    expect(api.chat).toHaveBeenCalledWith(
      expect.objectContaining({ message: "¿A qué hora abren?", conversationId: null }),
    );
    expect(root.textContent).toContain("Atendemos de 8 a 18.");
    const saved = new StateStore("pk_test").load();
    expect(saved.conversationId).toBe("conv_1");
    expect(saved.items.map((i) => i.kind)).toEqual(["user", "bot"]);
  });

  it("warns when few messages remain", async () => {
    const { root, widget } = mount({
      chat: vi.fn(() => Promise.resolve(reply({ remainingMessages: 2 }))),
    });
    await widget.send("hola");
    expect(root.textContent).toContain("Quedan 2 mensajes en esta conversación.");
  });

  it("keeps a single card per case and records the WhatsApp click", async () => {
    const chat = vi.fn(() => Promise.resolve(reply({ reply: "Te conecto.", handoff: HANDOFF })));
    const { root, widget, api } = mount({ chat });
    await widget.send(ASK_FOR_PERSON);
    await widget.send("¿siguen ahí?");
    expect(root.querySelectorAll(".card")).toHaveLength(1);

    root.querySelector<HTMLAnchorElement>(".card a")?.dispatchEvent(new Event("click"));
    expect(api.trackEvent).toHaveBeenCalledWith("DER-4821", {
      conversationToken: "t".repeat(43),
      type: "whatsapp_opened",
    });
  });

  it("tells the customer when sending fails and keeps the text", async () => {
    const chat = vi.fn(() => Promise.reject(new ApiRequestError(429, "rate_limited")));
    const { root, widget } = mount({ chat });
    await widget.send("hola");
    expect(root.textContent).toContain("Estás enviando muchos mensajes");
    expect(root.querySelector<HTMLInputElement>(".composer input")?.value).toBe("hola");
  });
});

describe("links in replies", () => {
  it("turns URLs into safe links that open in a new tab", () => {
    const parts = linkify("Completá el formulario: www.larural.com.py/automoviles. ¡Gracias!");
    expect(parts[0]).toBe("Completá el formulario: ");
    const a = parts[1] as HTMLAnchorElement;
    expect(a.href).toBe("https://www.larural.com.py/automoviles");
    expect(a.textContent).toBe("www.larural.com.py/automoviles");
    expect(a.target).toBe("_blank");
    expect(a.rel).toContain("noopener");
    expect(parts[2]).toBe(". ¡Gracias!");
  });

  it("never links other schemes and keeps text as text", () => {
    const parts = linkify("javascript:alert(1) <b>hola</b> https://ok.com/x?a=1");
    expect(parts.filter((p) => typeof p !== "string")).toHaveLength(1);
    expect((parts.at(-1) as HTMLAnchorElement).href).toBe("https://ok.com/x?a=1");
    expect(parts[0]).toBe("javascript:alert(1) <b>hola</b> ");
  });

  it("links only the assistant's messages", async () => {
    const chat = vi.fn(() => Promise.resolve(reply({ reply: "Mirá https://ejemplo.com" })));
    const { root, widget } = mount({ chat });
    await widget.send("mi web es https://mia.com");
    const links = [...root.querySelectorAll(".msg a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["https://ejemplo.com/"]);
  });
});

describe("voice", () => {
  it("uses vos across the widget texts when the business asks for it", async () => {
    const chat = vi.fn(() => Promise.resolve(reply({ handoff: HANDOFF })));
    const { root, widget } = mount({ chat }, { ...CONFIG, voice: "vos" });
    expect(root.querySelector<HTMLInputElement>(".composer input")?.placeholder).toBe(
      "Escribí tu consulta…",
    );
    await widget.send("hola");
    expect(root.textContent).toContain("solo tenés que enviarlo");
    expect(root.textContent).toContain("¿Preferís que te contacten?");
  });
});

describe("brand contrast", () => {
  it("uses dark text on light brand colors", () => {
    expect(textColorFor("#1F5FBF")).toBe("#fff");
    expect(textColorFor("#F5D90A")).toBe("#16202A");
  });
});
