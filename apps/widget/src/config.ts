declare const __PUENTE_API_URL__: string;

export interface WidgetSettings {
  key: string;
  apiUrl: string;
}

/**
 * The embedding <script data-key="pk_..."> tag. `currentScript` is null for module scripts
 * (the dev demo), so fall back to the first tag carrying data-key.
 */
export function findScript(doc: Document): HTMLScriptElement | null {
  const current = doc.currentScript;
  if (current instanceof HTMLScriptElement && current.dataset.key) return current;
  return doc.querySelector<HTMLScriptElement>("script[data-key]");
}

/**
 * The API lives on the same origin that serves the bundle (https://puente.x/widget/v1.js →
 * https://puente.x), so one build works on any domain. In development the source is served
 * by Vite on another port, hence the build-time fallback.
 */
export function defaultApiUrl(scriptSrc: string, isDev: boolean): string {
  if (isDev || !scriptSrc) return __PUENTE_API_URL__;
  try {
    return new URL(scriptSrc).origin;
  } catch {
    return __PUENTE_API_URL__;
  }
}

export function readSettings(
  script: HTMLScriptElement | null,
  isDev: boolean = import.meta.env.DEV,
): WidgetSettings | null {
  const key = script?.dataset.key?.trim();
  if (!key) return null;
  const apiUrl = (script?.dataset.api ?? defaultApiUrl(script?.src ?? "", isDev)).replace(
    /\/+$/,
    "",
  );
  return { key, apiUrl };
}
