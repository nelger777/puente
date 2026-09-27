// Puente widget entry point. The full chat UI arrives in milestone 3 (docs/SPEC.md §6).

const HOST_ID = "puente-widget-host";

function currentScriptKey(): string | null {
  const script = document.currentScript;
  return script instanceof HTMLScriptElement ? (script.dataset.key ?? null) : null;
}

function mount(key: string): void {
  if (document.getElementById(HOST_ID)) return;
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.dataset.key = key;
  host.attachShadow({ mode: "open" });
  document.body.appendChild(host);
}

const key = currentScriptKey();
if (key) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mount(key), { once: true });
  } else {
    mount(key);
  }
}
