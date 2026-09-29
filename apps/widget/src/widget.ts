import type { ChatResponse, WidgetConfigResponse } from "@puente/shared";
import { ApiRequestError, type WidgetApi } from "./api";
import { h, textColorFor } from "./dom";
import { renderHandoffCard, type CardHandlers } from "./handoff-card";
import { linkify } from "./linkify";
import type { ChatItem, HandoffItem, StateStore, WidgetState } from "./storage";
import { STYLES } from "./styles";
import { textsFor, type WidgetTexts } from "./texts";

export const ASK_FOR_PERSON = textsFor("tu").askForPerson;

export type ChatApi = Pick<WidgetApi, "chat" | "requestContact" | "trackEvent">;

const CHAT_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

/** The chat UI mounted inside a shadow root (docs/SPEC.md §6). */
export class ChatWidget {
  private state: WidgetState;
  private quickReplies: string[];
  private busy = false;

  private readonly launcher: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly list: HTMLElement;
  private readonly quick: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly typing: HTMLElement;
  private readonly cardHandlers: CardHandlers;
  private readonly t: WidgetTexts;

  constructor(
    root: ShadowRoot,
    private readonly config: WidgetConfigResponse,
    private readonly api: ChatApi,
    private readonly store: StateStore,
    options: { inline?: boolean } = {},
  ) {
    this.state = store.load();
    this.t = textsFor(config.voice);
    const t = this.t;
    const hasUserMessages = this.state.items.some((i) => i.kind === "user");
    this.quickReplies = hasUserMessages ? [] : config.suggestions;

    const host = root.host as HTMLElement;
    host.style.setProperty("--brand", config.brandColor);
    host.style.setProperty("--on-brand", textColorFor(config.brandColor));

    this.cardHandlers = {
      onWhatsApp: (item) => this.onWhatsApp(item),
      onContact: (item, name, phone) => this.onContact(item, name, phone),
    };

    this.launcher = h("button", {
      class: "launcher",
      type: "button",
      "aria-label": `Abrir el chat con ${config.botName}`,
      "aria-expanded": "false",
      "aria-controls": "puente-panel",
      onclick: () => this.setOpen(this.panel.hidden !== false),
    });
    this.launcher.innerHTML = CHAT_ICON; // static markup, no user data

    this.list = h("div", {
      class: "messages",
      role: "log",
      "aria-live": "polite",
      "aria-label": "Mensajes",
    });
    this.typing = h("p", { class: "typing", hidden: true }, t.typing(config.botName));
    this.quick = h("div", { class: "quick", "aria-label": "Sugerencias" });
    this.input = h("input", {
      type: "text",
      maxlength: 1000,
      placeholder: t.placeholder,
      "aria-label": "Tu mensaje",
      autocomplete: "off",
    });
    this.sendButton = h("button", { type: "submit" }, t.send);

    const initial = (config.botName.trim()[0] ?? "A").toUpperCase();
    this.panel = h(
      "div",
      {
        class: "panel",
        id: "puente-panel",
        role: "dialog",
        "aria-label": `Chat con ${config.botName} de ${config.businessName}`,
        hidden: true,
        onkeydown: (e: Event) => {
          if ((e as KeyboardEvent).key === "Escape") this.setOpen(false);
        },
      },
      h(
        "header",
        { class: "head" },
        this.renderAvatar(initial),
        h(
          "div",
          { class: "title" },
          h("b", {}, `${config.botName} · ${config.businessName}`),
          h("small", {}, config.inHours ? t.inHours : t.offHours),
        ),
        h(
          "button",
          {
            type: "button",
            title: "Hablar con una persona por WhatsApp",
            onclick: () => void this.send(t.askForPerson),
          },
          "Asesor",
        ),
        h(
          "button",
          {
            type: "button",
            class: "close",
            "aria-label": "Cerrar el chat",
            onclick: () => this.setOpen(false),
          },
          "×",
        ),
      ),
      this.list,
      this.quick,
      h(
        "form",
        {
          class: "composer",
          onsubmit: (e: Event) => {
            e.preventDefault();
            void this.send(this.input.value);
          },
        },
        this.input,
        this.sendButton,
      ),
    );

    const style = document.createElement("style");
    style.textContent = STYLES;
    root.append(style, this.panel, this.launcher);
    this.renderAll();
    if (options.inline) {
      host.classList.add("inline");
      this.panel.hidden = false;
    }
  }

  setOpen(open: boolean): void {
    this.panel.hidden = !open;
    this.launcher.setAttribute("aria-expanded", String(open));
    if (open) {
      this.scrollToEnd();
      this.input.focus();
    } else {
      this.launcher.focus();
    }
  }

  async send(raw: string): Promise<void> {
    const text = raw.trim();
    if (!text || this.busy) return;
    this.input.value = "";
    this.addItem({ kind: "user", text });
    this.setBusy(true);

    let response: ChatResponse;
    try {
      response = await this.api.chat({
        conversationId: this.state.conversationId,
        conversationToken: this.state.conversationToken,
        visitorId: this.state.visitorId,
        message: text,
      });
    } catch (err) {
      this.setBusy(false);
      const limited = err instanceof ApiRequestError && err.status === 429;
      this.addItem({
        kind: "notice",
        text: limited ? this.t.rateLimited : this.t.sendFailed,
      });
      this.input.value = text;
      return;
    }

    this.state.conversationId = response.conversationId;
    this.state.conversationToken = response.conversationToken;
    this.setBusy(false);
    this.addItem({ kind: "bot", text: response.reply });

    if (response.handoff) {
      // One card per case: an updated case moves to the end with its latest texts.
      const previous = this.state.items.find(
        (i): i is HandoffItem => i.kind === "handoff" && i.handoff.code === response.handoff?.code,
      );
      this.state.items = this.state.items.filter((i) => i !== previous);
      this.addItem({
        kind: "handoff",
        handoff: response.handoff,
        whatsappOpened: previous?.whatsappOpened ?? false,
        contactPhone: previous?.contactPhone ?? null,
      });
    } else if (response.remainingMessages <= 2) {
      this.addItem({
        kind: "notice",
        text:
          response.remainingMessages > 0
            ? this.t.remaining(response.remainingMessages)
            : this.t.limitReached,
      });
    }
    this.quickReplies = response.quickReplies;
    this.renderAll();
    this.input.focus();
  }

  private onWhatsApp(item: HandoffItem): void {
    const token = this.state.conversationToken;
    if (token) {
      this.api
        .trackEvent(item.handoff.code, { conversationToken: token, type: "whatsapp_opened" })
        .catch(() => undefined);
    }
    item.whatsappOpened = true;
    this.store.save(this.state);
    // Re-render after the click so the link navigation is not interrupted.
    setTimeout(() => this.renderAll(), 0);
  }

  private async onContact(item: HandoffItem, name: string, phone: string): Promise<void> {
    const token = this.state.conversationToken;
    if (!token) throw new Error("no conversation");
    await this.api.requestContact(item.handoff.code, {
      conversationToken: token,
      ...(name ? { name } : {}),
      phone,
      consent: true,
    });
    item.contactPhone = phone;
    this.store.save(this.state);
    this.renderAll();
  }

  private addItem(item: ChatItem): void {
    this.state.items.push(item);
    this.store.save(this.state);
    this.list.insertBefore(this.renderItem(item), this.typing);
    this.scrollToEnd();
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.typing.hidden = !busy;
    this.input.disabled = busy;
    this.sendButton.disabled = busy;
    if (busy) this.quick.replaceChildren();
    this.scrollToEnd();
  }

  private renderAll(): void {
    const greeting = h("div", { class: "msg bot" }, this.config.greeting);
    this.list.replaceChildren(
      greeting,
      ...this.state.items.map((i) => this.renderItem(i)),
      this.typing,
    );
    this.quick.replaceChildren(
      ...this.quickReplies
        .slice(0, 3)
        .map((q) => h("button", { type: "button", onclick: () => void this.send(q) }, q)),
    );
    this.scrollToEnd();
  }

  private renderItem(item: ChatItem): HTMLElement {
    if (item.kind === "handoff") {
      return renderHandoffCard(item, this.config.businessName, this.cardHandlers, this.t);
    }
    if (item.kind === "notice") return h("p", { class: "notice" }, item.text);
    // Assistant replies may carry links (quote forms, claims); the customer's text stays plain.
    if (item.kind === "bot") return h("div", { class: "msg bot" }, ...linkify(item.text));
    return h("div", { class: `msg ${item.kind}` }, item.text);
  }

  /** The assistant picture when there is one (https only), otherwise its initial. */
  private renderAvatar(initial: string): HTMLElement {
    const avatar = h("span", { class: "avatar", "aria-hidden": "true" });
    const url = this.config.avatarUrl;
    if (url && /^https?:\/\//.test(url)) {
      const img = h("img", { src: url, alt: "", width: 34, height: 34, decoding: "async" });
      img.addEventListener("error", () => avatar.replaceChildren(initial), { once: true });
      avatar.append(img);
    } else {
      avatar.append(initial);
    }
    return avatar;
  }

  private scrollToEnd(): void {
    this.list.scrollTop = this.list.scrollHeight;
  }
}
