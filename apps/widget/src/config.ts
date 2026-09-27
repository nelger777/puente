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

export function readSettings(script: HTMLScriptElement | null): WidgetSettings | null {
  const key = script?.dataset.key?.trim();
  if (!key) return null;
  const apiUrl = (script?.dataset.api ?? __PUENTE_API_URL__).replace(/\/+$/, "");
  return { key, apiUrl };
}
