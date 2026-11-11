import {
  CONVERSATION_DELETE_MAX,
  type ConversationListQuery,
  type ConversationOutcome,
  type ConversationSummary,
} from "@puente/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import { useIsAdmin } from "../auth";
import { Card, Empty, ErrorNote, Loading, PageHeader, StatusTag } from "../components/ui";
import { formatDate, LANGUAGE_LABELS } from "../lib/format";
import { usePending } from "../pending";

const OUTCOMES: { key: string; label: string; outcome?: ConversationOutcome }[] = [
  { key: "todas", label: "Todas" },
  { key: "resueltas", label: "Resueltas por el asistente", outcome: "resolved" },
  { key: "derivadas", label: "Derivadas", outcome: "handed_off" },
];

const PERIODS: { key: string; label: string; days?: number }[] = [
  { key: "todo", label: "Todo" },
  { key: "7", label: "7 días", days: 7 },
  { key: "30", label: "30 días", days: 30 },
  { key: "90", label: "90 días", days: 90 },
];

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

function Outcome({ c }: { c: ConversationSummary }) {
  if (!c.handoff) return <span className="tag tag-done">Resuelta por el asistente</span>;
  return (
    <>
      <span className="tag">Derivada · {c.handoff.code}</span>
      <StatusTag status={c.handoff.status} />
    </>
  );
}

export function ConversationsPage() {
  const isAdmin = useIsAdmin();
  const { refresh } = usePending();
  const [params, setParams] = useSearchParams();
  const outcome = OUTCOMES.find((o) => o.key === params.get("resultado")) ?? OUTCOMES[0];
  const period = PERIODS.find((p) => p.key === params.get("periodo")) ?? PERIODS[0];
  const q = params.get("q") ?? "";

  const [search, setSearch] = useState(q);
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const query = (): ConversationListQuery => ({
    outcome: outcome?.outcome,
    from: period?.days ? isoDay(new Date(Date.now() - (period.days - 1) * 86_400_000)) : undefined,
    q: q || undefined,
  });

  async function load(after?: string) {
    setLoading(true);
    setError(null);
    try {
      const page = await api.conversations({ ...query(), cursor: after });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      if (!after) setSelected(new Set());
    } catch (err) {
      setError(toError(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    setSearch(q);
  }, [outcome?.key, period?.key, q]);

  function setParam(name: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setParam("q", search.trim() || null);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < CONVERSATION_DELETE_MAX) next.add(id);
      return next;
    });
  }

  async function remove() {
    const ids = [...selected];
    const label = ids.length === 1 ? "1 conversación" : `${ids.length} conversaciones`;
    if (
      !window.confirm(
        `¿Eliminar ${label}? Se borran sus mensajes y derivaciones, y no se puede deshacer.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const { deleted } = await api.deleteConversations(ids);
      setItems((prev) => prev.filter((c) => !selected.has(c.id)));
      setSelected(new Set());
      setNotice(
        deleted === 1 ? "Conversación eliminada." : `${deleted} conversaciones eliminadas.`,
      );
      refresh();
    } catch (err) {
      setError(toError(err));
    } finally {
      setDeleting(false);
    }
  }

  const allShown = items.length > 0 && items.every((c) => selected.has(c.id));
  const toggleAll = () =>
    setSelected(
      allShown ? new Set() : new Set(items.slice(0, CONVERSATION_DELETE_MAX).map((c) => c.id)),
    );

  return (
    <>
      <PageHeader
        title="Conversaciones"
        subtitle="Todas las charlas con clientes, también las que el asistente resolvió solo. Las de “Probar” no aparecen."
      />
      <div className="filters" role="group" aria-label="Filtrar por resultado">
        {OUTCOMES.map((o) => (
          <button
            key={o.key}
            type="button"
            className="chip"
            aria-pressed={o.key === outcome?.key}
            onClick={() => setParam("resultado", o.key === "todas" ? null : o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="filters" role="group" aria-label="Filtrar por período">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="chip"
            aria-pressed={p.key === period?.key}
            onClick={() => setParam("periodo", p.key === "todo" ? null : p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
      <form className="search-bar" role="search" onSubmit={submitSearch}>
        <label htmlFor="conv-search" className="sr-only">
          Buscar en las conversaciones
        </label>
        <input
          id="conv-search"
          type="search"
          placeholder="Buscar texto o código DER-…"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className="btn ghost">
          Buscar
        </button>
        {q ? (
          <button type="button" className="btn ghost" onClick={() => setParam("q", null)}>
            Limpiar
          </button>
        ) : null}
      </form>

      {isAdmin && items.length > 0 ? (
        <div className="bulk-bar">
          <label>
            <input type="checkbox" checked={allShown} onChange={toggleAll} /> Seleccionar las
            mostradas
          </label>
          {selected.size > 0 ? (
            <button
              type="button"
              className="btn danger small"
              disabled={deleting}
              onClick={() => void remove()}
            >
              {deleting ? "Eliminando…" : `Eliminar (${selected.size})`}
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <p className="success-note" role="status">
          {notice}
        </p>
      ) : null}
      {error ? <ErrorNote error={error} onRetry={() => void load()} /> : null}
      {!loading && items.length === 0 && !error ? (
        <Empty>No hay conversaciones en esta vista.</Empty>
      ) : null}

      <div className="stack">
        {items.map((c) => (
          <Card key={c.id} className="conv-row">
            {isAdmin ? (
              <input
                type="checkbox"
                aria-label={`Seleccionar la conversación del ${formatDate(c.startedAt)}`}
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
              />
            ) : null}
            <Link to={`/conversaciones/${c.id}`} className="case-row">
              <div className="meta">
                <b>{formatDate(c.lastMessageAt)}</b>
                <Outcome c={c} />
                {c.language && c.language !== "es" ? (
                  <span className="tag">{LANGUAGE_LABELS[c.language]}</span>
                ) : null}
                <span>
                  {c.userMessages === 1 ? "1 mensaje" : `${c.userMessages} mensajes`} del cliente
                </span>
              </div>
              <p>{c.preview || "(sin texto)"}</p>
            </Link>
          </Card>
        ))}
      </div>
      {loading ? <Loading /> : null}
      {cursor && !loading ? (
        <div className="form-foot">
          <button type="button" className="btn ghost" onClick={() => void load(cursor)}>
            Cargar más
          </button>
        </div>
      ) : null}
    </>
  );
}
