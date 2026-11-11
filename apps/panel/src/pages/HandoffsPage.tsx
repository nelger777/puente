import type { HandoffListQuery, HandoffStatus, HandoffSummary } from "@puente/shared";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { api } from "../api/client";
import {
  Card,
  Empty,
  ErrorNote,
  Loading,
  PageHeader,
  ReasonTag,
  StatusTag,
} from "../components/ui";
import { eventLabel, formatDate } from "../lib/format";
import { usePending } from "../pending";

const FILTERS: { key: string; label: string; status?: HandoffStatus }[] = [
  { key: "todas", label: "Todas" },
  { key: "pendientes", label: "Pendientes", status: "PENDING" },
  { key: "atendidas", label: "Atendidas", status: "RESOLVED" },
];

const ASSIGNEES: { key: string; label: string; assignee?: HandoffListQuery["assignee"] }[] = [
  { key: "todos", label: "Cualquier responsable" },
  { key: "mios", label: "Míos", assignee: "me" },
  { key: "sin-asignar", label: "Sin asignar", assignee: "none" },
];

export function HandoffsPage() {
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f.key === params.get("estado")) ?? FILTERS[0];
  const owner = ASSIGNEES.find((a) => a.key === params.get("responsable")) ?? ASSIGNEES[0];
  const q = params.get("q") ?? "";
  const { refresh } = usePending();
  const [search, setSearch] = useState(q);
  const [items, setItems] = useState<HandoffSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const query = (): HandoffListQuery => ({
    status: filter?.status,
    assignee: owner?.assignee,
    q: q || undefined,
  });

  async function load(after?: string) {
    setLoading(true);
    setError(null);
    try {
      const page = await api.handoffs({ ...query(), cursor: after });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    setSearch(q);
    refresh();
  }, [filter?.key, owner?.key, q, refresh]);

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

  return (
    <>
      <PageHeader
        title="Derivaciones"
        subtitle="Cada caso queda registrado aunque el cliente no llegue a enviar el WhatsApp."
      />
      <div className="filters" role="group" aria-label="Filtrar por estado">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="chip"
            aria-pressed={f.key === filter?.key}
            onClick={() => setParam("estado", f.key === "todas" ? null : f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="filters" role="group" aria-label="Filtrar por responsable">
        {ASSIGNEES.map((a) => (
          <button
            key={a.key}
            type="button"
            className="chip"
            aria-pressed={a.key === owner?.key}
            onClick={() => setParam("responsable", a.key === "todos" ? null : a.key)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <form className="search-bar" role="search" onSubmit={submitSearch}>
        <label htmlFor="handoff-search" className="sr-only">
          Buscar derivaciones
        </label>
        <input
          id="handoff-search"
          type="search"
          placeholder="Código DER-…, teléfono o nombre del cliente"
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
      {error ? <ErrorNote error={error} onRetry={() => void load()} /> : null}
      {!loading && items.length === 0 && !error ? <Empty>No hay casos en esta vista.</Empty> : null}
      <div className="stack">
        {items.map((h) => (
          <Link key={h.code} to={`/derivaciones/${h.code}`} className="case-row">
            <Card>
              <div className="meta">
                <b>{h.code}</b>
                <ReasonTag reason={h.reason} />
                <StatusTag status={h.status} />
                <span>
                  {formatDate(h.createdAt)}
                  {h.openedInHours ? "" : " · fuera de horario"}
                </span>
              </div>
              <p>{h.summary}</p>
              <div className="meta">
                <span>
                  {h.contactPhone
                    ? `${h.contactName ?? "Sin nombre"} · ${h.contactPhone}`
                    : "Sin datos de contacto"}
                </span>
                <span>· {h.assignee ? `Responsable: ${h.assignee.email}` : "Sin responsable"}</span>
                {h.noteCount ? (
                  <span>· {h.noteCount === 1 ? "1 nota" : `${h.noteCount} notas`}</span>
                ) : null}
                {h.lastEvent ? <span>· Último evento: {eventLabel(h.lastEvent.type)}</span> : null}
              </div>
            </Card>
          </Link>
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
