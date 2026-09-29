import type { BusinessResponse, LlmProvider } from "@puente/shared";
import { useState } from "react";
import { api } from "../api/client";
import { Card } from "./ui";

const OPTIONS: { value: LlmProvider; label: string; help: string }[] = [
  {
    value: "default",
    label: "Predeterminado (Claude de Puente)",
    help: "Usa la clave de Claude configurada en el servidor.",
  },
  {
    value: "claude",
    label: "Claude con clave propia",
    help: "Clave de console.anthropic.com. El consumo se cobra en esa cuenta.",
  },
  {
    value: "gemini",
    label: "Gemini gratis (solo demo)",
    help:
      "Clave de aistudio.google.com. En el plan gratuito Google puede usar las conversaciones " +
      "para mejorar sus productos y tiene límites diarios: no lo uses con clientes reales.",
  },
];

/** AI engine of the business. The key is write-only: it is never shown again. */
export function LlmCard({
  business,
  onChange,
}: {
  business: BusinessResponse;
  onChange: (business: BusinessResponse) => void;
}) {
  const saved = business.llm;
  const [provider, setProvider] = useState<LlmProvider>(saved.provider);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const needsKey = provider !== "default";
  const keepsKey = needsKey && provider === saved.provider && saved.hasKey;
  const dirty = provider !== saved.provider || apiKey.trim() !== "";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const key = apiKey.trim();
      const next = await api.updateLlm({ provider, ...(needsKey && key ? { apiKey: key } : {}) });
      onChange(next);
      setApiKey("");
      setMessage({ ok: true, text: "Guardado. Prueba la conexión antes de usarlo." });
    });

  const test = () =>
    run(async () => {
      const result = await api.testLlm();
      setMessage({
        ok: result.ok,
        text: result.ok ? `${result.message} (${result.latencyMs ?? "?"} ms)` : result.message,
      });
    });

  return (
    <Card title="Motor de IA">
      <div className="form">
        <div className="field full">
          <label htmlFor="llm-provider">Motor</label>
          <select
            id="llm-provider"
            value={provider}
            disabled={busy}
            onChange={(e) => {
              setProvider(e.target.value as LlmProvider);
              setMessage(null);
            }}
          >
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="help">{OPTIONS.find((o) => o.value === provider)?.help}</p>
        </div>
        {needsKey ? (
          <div className="field full">
            <label htmlFor="llm-key">Clave de API</label>
            <input
              id="llm-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              disabled={busy}
              placeholder={
                keepsKey ? `Guardada, termina en ${saved.keyLast4 ?? "····"}` : "Pega la clave aquí"
              }
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="help">
              Se guarda cifrada y nunca se vuelve a mostrar.
              {keepsKey ? " Déjala vacía para conservar la actual." : ""}
            </p>
          </div>
        ) : null}
        <div className="form-foot full">
          <button
            type="button"
            className="btn"
            disabled={busy || !dirty || (needsKey && !keepsKey && apiKey.trim() === "")}
            onClick={() => void save()}
          >
            Guardar motor
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy || dirty}
            title={dirty ? "Guarda primero los cambios" : undefined}
            onClick={() => void test()}
          >
            Probar conexión
          </button>
          {message ? (
            <span
              className={message.ok ? "success-note" : "field-error"}
              role={message.ok ? "status" : "alert"}
            >
              {message.text}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
