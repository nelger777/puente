import type {
  ApiErrorResponse,
  ChatRequest,
  ChatResponse,
  HandoffContactRequest,
  HandoffEventRequest,
  WidgetConfigResponse,
} from "@puente/shared";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiRequestError";
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init.body ? { "content-type": "application/json" } : undefined,
      credentials: "omit",
    });
  } catch {
    throw new ApiRequestError(0, "network_error");
  }
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (body as Partial<ApiErrorResponse> | null)?.error?.code ?? "unknown_error";
    throw new ApiRequestError(res.status, code);
  }
  return body as T;
}

/** Only type imports from @puente/shared: the contracts, without shipping zod to browsers. */
export class WidgetApi {
  constructor(
    private readonly baseUrl: string,
    private readonly key: string,
  ) {}

  config(): Promise<WidgetConfigResponse> {
    return request(`${this.baseUrl}/v1/widget/config?key=${encodeURIComponent(this.key)}`);
  }

  chat(input: Omit<ChatRequest, "key">): Promise<ChatResponse> {
    return request(`${this.baseUrl}/v1/chat`, {
      method: "POST",
      body: JSON.stringify({ key: this.key, ...input }),
    });
  }

  requestContact(code: string, input: Omit<HandoffContactRequest, "key">): Promise<void> {
    return request(`${this.baseUrl}/v1/handoffs/${encodeURIComponent(code)}/contact`, {
      method: "POST",
      body: JSON.stringify({ key: this.key, ...input }),
    });
  }

  /** keepalive: the WhatsApp tab opens at the same moment, the request must survive it. */
  trackEvent(code: string, input: Omit<HandoffEventRequest, "key">): Promise<void> {
    return request(`${this.baseUrl}/v1/handoffs/${encodeURIComponent(code)}/events`, {
      method: "POST",
      body: JSON.stringify({ key: this.key, ...input }),
      keepalive: true,
    });
  }
}
