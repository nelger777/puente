import { HandoffReasonSchema } from "@puente/shared";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { Card, Empty, ErrorNote, Loading, PageHeader, ReasonTag } from "../components/ui";
import { formatDate, formatNumber, reasonLabel } from "../lib/format";
import { useApi } from "../lib/use-api";

const PERIODS = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
];

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function SummaryPage() {
  const { me } = useAuth();
  const [days, setDays] = useState(30);
  const metrics = useApi(() => {
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86_400_000);
    return api.metrics(isoDay(from), isoDay(to));
  }, [days]);

  const periodPicker = (
    <div className="filters" role="group" aria-label="Período">
      {PERIODS.map((p) => (
        <button
          key={p.days}
          type="button"
          className="chip"
          aria-pressed={p.days === days}
          onClick={() => setDays(p.days)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  const m = metrics.data;
  return (
    <>
      <PageHeader
        title={me?.business.name ?? "Resumen"}
        subtitle="Cómo rinde el asistente. Las conversaciones de “Probar” no cuentan."
        actions={periodPicker}
      />
      {metrics.error ? <ErrorNote error={metrics.error} onRetry={metrics.reload} /> : null}
      {!m ? (
        metrics.loading ? (
          <Loading />
        ) : null
      ) : (
        <>
          <div className="stats">
            <div className="card stat">
              <b>{formatNumber(m.userMessages)}</b>
              <span>Mensajes de clientes</span>
            </div>
            <div className="card stat">
              <b>{formatNumber(m.resolvedByAssistant)}</b>
              <span>Resueltos por el asistente</span>
            </div>
            <div className="card stat">
              <b>{formatNumber(m.handedOff)}</b>
              <span>Derivados al equipo</span>
            </div>
            <div className="card stat">
              <b>{Math.round(m.resolutionRate * 100)}%</b>
              <span>Tasa de resolución ({formatNumber(m.conversations)} conversaciones)</span>
            </div>
          </div>
          <div className="grid-2">
            <Card title="Motivos de derivación">
              {m.handedOff === 0 ? (
                <p className="muted">Sin derivaciones en este período.</p>
              ) : (
                HandoffReasonSchema.options
                  .map((r) => [r, m.handoffsByReason[r]] as const)
                  .filter(([, n]) => n > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([reason, n]) => {
                    const max = Math.max(...Object.values(m.handoffsByReason), 1);
                    return (
                      <div className="bar" key={reason}>
                        <span>{reasonLabel(reason)}</span>
                        <div className="track" aria-hidden="true">
                          <div className="fill" style={{ width: `${(100 * n) / max}%` }} />
                        </div>
                        <b>{n}</b>
                      </div>
                    );
                  })
              )}
              <p className="muted small">
                IA: {formatNumber(m.tokens.llmCalls)} respuestas · {formatNumber(m.tokens.input)}{" "}
                tokens de entrada · {formatNumber(m.tokens.output)} de salida
              </p>
            </Card>
            <Card title={`Pendientes de atender (${m.pendingCount})`}>
              {m.recentPending.length === 0 ? (
                <Empty>No hay casos pendientes.</Empty>
              ) : (
                <>
                  {m.recentPending.map((h) => (
                    <Link key={h.code} to={`/derivaciones/${h.code}`} className="row-link">
                      <div className="meta">
                        <b>{h.code}</b>
                        <ReasonTag reason={h.reason} />
                        <span>{formatDate(h.createdAt)}</span>
                      </div>
                      <div>{h.summary}</div>
                    </Link>
                  ))}
                  <Link to="/derivaciones?estado=pendientes" className="btn ghost small">
                    Ver todas
                  </Link>
                </>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
