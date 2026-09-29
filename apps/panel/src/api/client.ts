import type {
  ApiErrorResponse,
  BusinessResponse,
  BusinessSettings,
  ChatResponse,
  HandoffDetail,
  HandoffListResponse,
  HandoffStatus,
  KnowledgeItemInput,
  KnowledgeResponse,
  LlmSettings,
  LlmTestResponse,
  LoginRequest,
  MeResponse,
  MetricsResponse,
  PreviewChatRequest,
} from "@puente/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

/** The auth provider subscribes to send the user back to the login screen. */
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network_error", "No hay conexión con el servidor.");
  }
  if (res.status === 204) return undefined as T;
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (json as Partial<ApiErrorResponse> | null)?.error;
    if (res.status === 401 && !path.endsWith("/auth/login")) {
      unauthorizedListeners.forEach((l) => l());
    }
    throw new ApiError(
      res.status,
      error?.code ?? "unknown_error",
      error?.message ?? "Error inesperado",
    );
  }
  return json as T;
}

const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter((e): e is [string, string] => !!e[1]);
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : "";
};

export const api = {
  login: (body: LoginRequest) => request<MeResponse>("POST", "/v1/auth/login", body),
  logout: () => request<void>("POST", "/v1/auth/logout"),
  me: () => request<MeResponse>("GET", "/v1/auth/me"),

  business: () => request<BusinessResponse>("GET", "/v1/admin/business"),
  updateBusiness: (body: BusinessSettings) =>
    request<BusinessResponse>("PUT", "/v1/admin/business", body),
  uploadAvatar: (dataUrl: string) =>
    request<BusinessResponse>("PUT", "/v1/admin/business/avatar", { dataUrl }),
  removeAvatar: () => request<BusinessResponse>("DELETE", "/v1/admin/business/avatar"),
  updateLlm: (body: LlmSettings) =>
    request<BusinessResponse>("PUT", "/v1/admin/business/llm", body),
  testLlm: () => request<LlmTestResponse>("POST", "/v1/admin/business/llm/test"),

  knowledge: () => request<KnowledgeResponse>("GET", "/v1/admin/knowledge"),
  replaceKnowledge: (items: KnowledgeItemInput[]) =>
    request<KnowledgeResponse>("PUT", "/v1/admin/knowledge", { items }),

  handoffs: (status?: HandoffStatus, cursor?: string) =>
    request<HandoffListResponse>("GET", `/v1/admin/handoffs${qs({ status, cursor })}`),
  handoff: (code: string) =>
    request<HandoffDetail>("GET", `/v1/admin/handoffs/${encodeURIComponent(code)}`),
  setHandoffStatus: (code: string, status: HandoffStatus) =>
    request<HandoffDetail>("PATCH", `/v1/admin/handoffs/${encodeURIComponent(code)}`, { status }),

  metrics: (from?: string, to?: string) =>
    request<MetricsResponse>("GET", `/v1/admin/metrics${qs({ from, to })}`),

  previewChat: (body: Omit<PreviewChatRequest, "visitorId"> & { visitorId?: string }) =>
    request<ChatResponse>("POST", "/v1/admin/preview-chat", body),
};
