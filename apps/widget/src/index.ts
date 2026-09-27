import { WidgetApi } from "./api";
import { findScript, readSettings } from "./config";
import { StateStore } from "./storage";
import { ChatWidget } from "./widget";

const HOST_ID = "puente-widget";

async function boot(script: HTMLScriptElement): Promise<void> {
  if (document.getElementById(HOST_ID)) return;
  const settings = readSettings(script);
  if (!settings) {
    console.warn("[Puente] Falta el atributo data-key en el <script> del widget.");
    return;
  }

  const api = new WidgetApi(settings.apiUrl, settings.key);
  let config;
  try {
    config = await api.config();
  } catch (err) {
    // Unknown key or unauthorized domain: stay invisible instead of breaking the page.
    console.warn("[Puente] El asistente no está disponible en este sitio.", err);
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: "open" });
  new ChatWidget(root, config, api, new StateStore(settings.key));
}

// currentScript is only available synchronously, so read it before awaiting anything.
const script = findScript(document);
if (script) {
  const start = () => void boot(script);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
