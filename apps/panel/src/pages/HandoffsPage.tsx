import type { HandoffStatus, HandoffSummary } from "@puente/shared";
import { useEffect, useState } from "react";
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

export function HandoffsPage() {
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f.key === params.get("estado")) ?? FILTERS[0];
  const { refresh } = usePending();
  const [items, setItems] = useState<HandoffSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  async function load(status: HandoffStatus | undefined, after?: string) {
    setLoading(true);
    setError(null);
    try {
      const page = await api.handoffs(status, after);
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(filter?.status);
    refresh();
  }, [filter?.status, refresh]);

  return (
    <>
      <PageHeader
        title="Derivaciones"
        subtitle="Cada caso queda registrado aunque el cliente no llegue a enviar el WhatsApp."
      />
      <div className="filters" role="group" aria-label="Filtrar derivaciones">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="chip"
            aria-pressed={f.key === filter?.key}
            onClick={() => setParams(f.key === "todas" ? {} : { estado: f.key })}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error ? <ErrorNote error={error} onRetry={() => void load(filter?.status)} /> : null}
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
                {h.lastEvent ? <span>· Último evento: {eventLabel(h.lastEvent.type)}</span> : null}
              </div>
            </Card>
          </Link>
        ))}
      </div>
      {loading ? <Loading /> : null}
      {cursor && !loading ? (
        <div className="form-foot">
          <button
            type="button"
            className="btn ghost"
            onClick={() => void load(filter?.status, cursor)}
          >
            Cargar más
          </button>
        </div>
      ) : null}
    </>
  );
}
