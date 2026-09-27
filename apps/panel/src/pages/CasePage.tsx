import { useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api/client";
import { Card, ErrorNote, Loading, PageHeader, ReasonTag, StatusTag } from "../components/ui";
import { eventLabel, formatDate, waChatUrl } from "../lib/format";
import { useApi } from "../lib/use-api";
import { usePending } from "../pending";

export function CasePage() {
  const { code = "" } = useParams();
  const { refresh } = usePending();
  const handoff = useApi(() => api.handoff(code), [code]);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  async function toggleStatus() {
    const h = handoff.data;
    if (!h) return;
    setSaving(true);
    setActionError(null);
    try {
      handoff.setData(
        await api.setHandoffStatus(h.code, h.status === "PENDING" ? "RESOLVED" : "PENDING"),
      );
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setSaving(false);
    }
  }

  const h = handoff.data;
  return (
    <>
      <Link to="/derivaciones" className="muted small">
        ‹ Volver a derivaciones
      </Link>
      <PageHeader title={`Caso ${code}`} />
      {handoff.error ? <ErrorNote error={handoff.error} onRetry={handoff.reload} /> : null}
      {!h ? (
        handoff.loading ? (
          <Loading />
        ) : null
      ) : (
        <div className="case-grid">
          <Card title={`Conversación (${h.messages.length} mensajes)`}>
            <div className="transcript">
              {h.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`}>
                  {m.content}
                  <time dateTime={m.createdAt}>{formatDate(m.createdAt)}</time>
                </div>
              ))}
            </div>
          </Card>
          <div className="stack">
            <Card title="Datos del caso">
              <dl className="kv">
                <dt>Estado</dt>
                <dd>
                  <StatusTag status={h.status} />
                </dd>
                <dt>Motivo</dt>
                <dd>
                  <ReasonTag reason={h.reason} />
                </dd>
                <dt>Fecha</dt>
                <dd>
                  {formatDate(h.createdAt)}
                  {h.openedInHours ? "" : " · fuera de horario"}
                </dd>
                <dt>Cliente</dt>
                <dd>
                  {h.contactPhone
                    ? `${h.contactName ?? "Sin nombre"} · ${h.contactPhone}`
                    : "No dejó datos de contacto"}
                </dd>
                <dt>Sitio</dt>
                <dd>{h.conversation.originDomain}</dd>
                <dt>Resumen</dt>
                <dd>{h.summary}</dd>
              </dl>
              <h3 className="small muted">Mensaje de WhatsApp del cliente</h3>
              <p className="wa-text">{h.waMessage}</p>
              <div className="form-foot">
                {h.contactPhone ? (
                  <a
                    className="btn wa"
                    href={waChatUrl(h.contactPhone)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Escribir al cliente
                  </a>
                ) : null}
                <button
                  type="button"
                  className="btn ghost"
                  disabled={saving}
                  onClick={() => void toggleStatus()}
                >
                  {h.status === "PENDING" ? "Marcar atendido" : "Reabrir"}
                </button>
              </div>
              {h.contactPhone && !h.contactPhone.trim().startsWith("+") ? (
                <p className="muted small">
                  Si el teléfono no tiene código de país, WhatsApp puede no abrir el chat correcto.
                </p>
              ) : null}
              {actionError ? <ErrorNote error={actionError} /> : null}
            </Card>
            <Card title="Eventos">
              <ol className="events">
                {h.events.map((e, i) => (
                  <li key={i}>
                    <span className="muted small">{formatDate(e.createdAt)}</span>{" "}
                    {eventLabel(e.type)}
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
