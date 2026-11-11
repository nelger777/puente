import { HANDOFF_NOTE_MAX, type HandoffDetail } from "@puente/shared";
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api/client";
import { useIsAdmin } from "../auth";
import { Card, ErrorNote, Loading, PageHeader, ReasonTag, StatusTag } from "../components/ui";
import { eventLabel, formatDate, waChatUrl } from "../lib/format";
import { useApi } from "../lib/use-api";
import { usePending } from "../pending";

export function CasePage() {
  const { code = "" } = useParams();
  const { refresh } = usePending();
  const isAdmin = useIsAdmin();
  const handoff = useApi(() => api.handoff(code), [code]);
  const team = useApi(() => api.team(), []);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);
  const [note, setNote] = useState("");

  /** Runs a change to the case and shows the case as the server returns it. */
  async function run(action: () => Promise<HandoffDetail>): Promise<boolean> {
    setSaving(true);
    setActionError(null);
    try {
      handoff.setData(await action());
      refresh();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error(String(err)));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function toggleStatus() {
    const h = handoff.data;
    if (!h) return;
    void run(() =>
      api.updateHandoff(h.code, { status: h.status === "PENDING" ? "RESOLVED" : "PENDING" }),
    );
  }

  function assign(assigneeId: string) {
    void run(() => api.updateHandoff(code, { assigneeId: assigneeId || null }));
  }

  async function addNote(event: FormEvent) {
    event.preventDefault();
    const body = note.trim();
    if (!body) return;
    if (await run(() => api.addHandoffNote(code, body))) setNote("");
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
                <dt>
                  <label htmlFor="case-assignee">Responsable</label>
                </dt>
                <dd>
                  <select
                    id="case-assignee"
                    className="inline-select"
                    value={h.assignee?.id ?? ""}
                    disabled={saving || !team.data}
                    onChange={(e) => assign(e.target.value)}
                  >
                    <option value="">Sin responsable</option>
                    {/* A disabled user keeps showing until the case is reassigned. */}
                    {h.assignee && !team.data?.members.some((m) => m.id === h.assignee?.id) ? (
                      <option value={h.assignee.id}>{h.assignee.email}</option>
                    ) : null}
                    {team.data?.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.email}
                      </option>
                    ))}
                  </select>
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
                  onClick={toggleStatus}
                >
                  {h.status === "PENDING" ? "Marcar atendido" : "Reabrir"}
                </button>
              </div>
              {isAdmin &&
              h.reason === "NO_INFORMATION" &&
              !h.events.some((e) => e.type.startsWith("knowledge_")) ? (
                <p className="small">
                  El asistente no tenía esta respuesta.{" "}
                  <Link to="/sin-respuesta">Agrégala a la base desde Sin respuesta</Link>.
                </p>
              ) : null}
              {h.contactPhone && !h.contactPhone.trim().startsWith("+") ? (
                <p className="muted small">
                  Si el teléfono no tiene código de país, WhatsApp puede no abrir el chat correcto.
                </p>
              ) : null}
              {actionError ? <ErrorNote error={actionError} /> : null}
            </Card>
            <Card title={`Notas internas (${h.notes.length})`}>
              <p className="muted small">Solo las ve el equipo; el cliente nunca.</p>
              {h.notes.length ? (
                <ol className="notes">
                  {h.notes.map((n) => (
                    <li key={n.id}>
                      <p>{n.body}</p>
                      <span className="muted small">
                        {n.author ?? "Usuario eliminado"} · {formatDate(n.createdAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
              <form onSubmit={(e) => void addNote(e)}>
                <div className="field">
                  <label htmlFor="case-note">Agregar una nota</label>
                  <textarea
                    id="case-note"
                    rows={3}
                    maxLength={HANDOFF_NOTE_MAX}
                    placeholder="Ej.: Llamé a las 15:00 y no atendió; reintentar mañana."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
                <div className="form-foot">
                  <button type="submit" className="btn ghost" disabled={saving || !note.trim()}>
                    Guardar nota
                  </button>
                </div>
              </form>
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
