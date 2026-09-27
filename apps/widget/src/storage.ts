import type { ChatHandoff } from "@puente/shared";

export type TextItem = { kind: "user" | "bot" | "notice"; text: string };

export type HandoffItem = {
  kind: "handoff";
  handoff: ChatHandoff;
  /** What the customer already did with the card. */
  whatsappOpened: boolean;
  contactPhone: string | null;
};

export type ChatItem = TextItem | HandoffItem;

export interface WidgetState {
  visitorId: string;
  conversationId: string | null;
  conversationToken: string | null;
  items: ChatItem[];
}

const MAX_ITEMS = 50;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `v_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function emptyState(): WidgetState {
  return { visitorId: randomId(), conversationId: null, conversationToken: null, items: [] };
}

function isState(value: unknown): value is WidgetState {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.visitorId === "string" && Array.isArray(v.items);
}

/**
 * Per-business state in localStorage. Storage may be missing or throw (private mode,
 * blocked cookies): the widget then keeps working in memory only.
 */
export class StateStore {
  private readonly storageKey: string;

  constructor(
    businessKey: string,
    private readonly storage: () => Storage | null = () => globalThis.localStorage,
  ) {
    this.storageKey = `puente:${businessKey}`;
  }

  load(): WidgetState {
    try {
      const raw = this.storage()?.getItem(this.storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return isState(parsed) ? parsed : emptyState();
    } catch {
      return emptyState();
    }
  }

  save(state: WidgetState): void {
    try {
      const trimmed = { ...state, items: state.items.slice(-MAX_ITEMS) };
      this.storage()?.setItem(this.storageKey, JSON.stringify(trimmed));
    } catch {
      // storage full or blocked: keep the in-memory state
    }
  }
}
