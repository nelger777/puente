import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { Card, ErrorNote, Loading, PageHeader } from "../components/ui";
import { useApi } from "../lib/use-api";

export function InstallPage() {
  const business = useApi(() => api.business(), []);
  const [copied, setCopied] = useState<"ok" | "error" | null>(null);

  if (business.error) return <ErrorNote error={business.error} onRetry={business.reload} />;
  const b = business.data;
  if (!b) return <Loading />;

  const snippet = `<script src="${b.widgetScriptUrl}" data-key="${b.publicKey}" async></script>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied("ok");
    } catch {
      setCopied("error");
    }
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <>
      <PageHeader
        title="Instalación"
        subtitle="Una sola línea de código en el sitio de tu negocio."
      />
      <div className="stack">
        <Card title="1. Copia este código">
          <pre className="code" aria-label="Código de instalación">
            {snippet}
          </pre>
          <div className="form-foot">
            <button type="button" className="btn" onClick={() => void copy()}>
              Copiar código
            </button>
            {copied === "ok" ? (
              <span className="success-note" role="status">
                Copiado
              </span>
            ) : null}
            {copied === "error" ? (
              <span className="field-error" role="alert">
                No se pudo copiar; selecciona el texto y cópialo a mano.
              </span>
            ) : null}
          </div>
        </Card>
        <Card title="2. Pégalo en tu sitio">
          <p>
            Pégalo antes de <code>&lt;/body&gt;</code> en todas las páginas donde quieras el
            asistente. En WordPress, Wix o Shopify usa la opción de “código personalizado” o
            “scripts del pie de página”.
          </p>
        </Card>
        <Card title="3. Autoriza tu dominio">
          {b.allowedDomains.length ? (
            <p>
              El asistente solo funciona en: <b>{b.allowedDomains.join(", ")}</b>.
            </p>
          ) : (
            <p className="field-error">
              Todavía no hay dominios autorizados: el asistente no se mostrará.
            </p>
          )}
          <p className="muted">
            Puedes cambiarlos en <Link to="/configuracion">Configuración</Link>. Antes de
            publicarlo, pruébalo en <Link to="/probar">Probar</Link>.
          </p>
        </Card>
      </div>
    </>
  );
}
