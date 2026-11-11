import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { useIsAdmin } from "../auth";
import { Card, ErrorNote, Loading, PageHeader, ReasonTag, StatusTag } from "../components/ui";
import { formatDate, LANGUAGE_LABELS } from "../lib/format";
import { useApi } from "../lib/use-api";
import { usePending } from "../pending";

export function ConversationPage() {
  const { id = "" } = useParams();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const { refresh } = usePending();
  const conversation = useApi(() => api.conversation(id), [id]);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<Error | null>(null);

  async function remove() {
    if (
      !window.confirm(
        "¿Eliminar esta conversación? Se borran sus mensajes y derivaciones, y no se puede deshacer.",
      )
    ) {
      return;
    }
    setDeleting(true);
    setActionError(null);
    try {
      await api.deleteConversations([id]);
      refresh();
      void navigate("/conversaciones", { replace: true });
    } catch (err) {
      setActionError(err instanceof Error ? err : new Error(String(err)));
      setDeleting(false);
    }
  }

  const c = conversation.data;
  return (
    <>
      <Link to="/conversaciones" className="muted small">
        ‹ Volver a conversaciones
      </Link>
      <PageHeader title={c ? `Conversación del ${formatDate(c.startedAt)}` : "Conversación"} />
      {conversation.error ? (
        <ErrorNote error={conversation.error} onRetry={conversation.reload} />
      ) : null}
      {!c ? (
        conversation.loading ? (
          <Loading />
        ) : null
      ) : (
        <div className="case-grid">
          <Card title={`Mensajes (${c.messages.length})`}>
            <div className="transcript">
              {c.messages.map((m) => (
                <div key={m.id} className={`bubble ${m.role}`}>
                  {m.content}
                  <time dateTime={m.createdAt}>{formatDate(m.createdAt)}</time>
                </div>
              ))}
            </div>
          </Card>
          <div className="stack">
            <Card title="Datos">
              <dl className="kv">
                <dt>Inicio</dt>
                <dd>{formatDate(c.startedAt)}</dd>
                <dt>Último mensaje</dt>
                <dd>{formatDate(c.lastMessageAt)}</dd>
                <dt>Idioma</dt>
                <dd>{c.language ? LANGUAGE_LABELS[c.language] : "Sin detectar"}</dd>
                <dt>Sitio</dt>
                <dd>{c.originDomain}</dd>
                <dt>Resultado</dt>
                <dd>{c.handoffs.length ? "Derivada al equipo" : "Resuelta por el asistente"}</dd>
              </dl>
              {c.handoffs.length ? (
                <ul className="plain-list">
                  {c.handoffs.map((h) => (
                    <li key={h.code} className="meta">
                      <Link to={`/derivaciones/${h.code}`}>
                        <b>{h.code}</b>
                      </Link>
                      <ReasonTag reason={h.reason} />
                      <StatusTag status={h.status} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {isAdmin ? (
                <div className="form-foot">
                  <button
                    type="button"
                    className="btn danger"
                    disabled={deleting}
                    onClick={() => void remove()}
                  >
                    {deleting ? "Eliminando…" : "Eliminar conversación"}
                  </button>
                </div>
              ) : null}
              {actionError ? <ErrorNote error={actionError} /> : null}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
