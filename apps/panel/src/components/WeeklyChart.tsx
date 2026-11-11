import type { MetricsResponse } from "@puente/shared";
import { useEffect, useRef, useState } from "react";
import { formatNumber } from "../lib/format";

type Week = MetricsResponse["weekly"][number];

const weekLabel = new Intl.DateTimeFormat("es", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
/** "3 nov": weeks are local dates, so format them as plain dates (UTC noon). */
export const formatWeek = (day: string) => weekLabel.format(new Date(`${day}T12:00:00Z`));

const SERIES = [
  { key: "resolved", label: "Resueltas por el asistente", className: "s1" },
  { key: "handedOff", label: "Derivadas al equipo", className: "s2" },
] as const;

/** The total label sits in the column too: segments share what is left of its height. */
const segment = (n: number, max: number) => `calc((100% - 18px) * ${n / max})`;

/** Stacked weekly columns: resolved at the base, handed off on top; total on the cap. */
export function WeeklyChart({ weekly }: { weekly: Week[] }) {
  const [active, setActive] = useState<number | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...weekly.map((w) => w.conversations));

  // On narrow screens the plot scrolls: start on the latest weeks, which matter most.
  useEffect(() => {
    if (plot.current) plot.current.scrollLeft = plot.current.scrollWidth;
  }, [weekly]);

  return (
    <div className="wk">
      <ul className="wk-legend" aria-label="Series">
        {SERIES.map((s) => (
          <li key={s.key}>
            <span className={`wk-key ${s.className}`} aria-hidden="true" />
            {s.label}
          </li>
        ))}
      </ul>
      <div ref={plot} className="wk-plot" onPointerLeave={() => setActive(null)}>
        {weekly.map((w, i) => (
          <div
            key={w.weekStart}
            className="wk-col"
            tabIndex={0}
            aria-label={`Semana del ${formatWeek(w.weekStart)}: ${w.conversations} conversaciones, ${w.resolved} resueltas, ${w.handedOff} derivadas`}
            onPointerEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <div className="wk-bar" aria-hidden="true">
              <span className="wk-total">
                {w.conversations ? formatNumber(w.conversations) : ""}
              </span>
              {/* Top segment first in the DOM; the column stacks bottom-up. */}
              {w.handedOff ? (
                <span className="wk-seg s2" style={{ height: segment(w.handedOff, max) }} />
              ) : null}
              {w.resolved ? (
                <span className="wk-seg s1" style={{ height: segment(w.resolved, max) }} />
              ) : null}
            </div>
            <span className="wk-x" aria-hidden="true">
              {formatWeek(w.weekStart)}
            </span>
            {active === i ? (
              // Beside the column, never over it: right of the first half, left of the second.
              <div className={`wk-tip ${i < weekly.length / 2 ? "right" : "left"}`} role="tooltip">
                <span>
                  <b>{formatNumber(w.conversations)}</b> conversaciones
                </span>
                <span className="muted small">Semana del {formatWeek(w.weekStart)}</span>
                {SERIES.map((s) => (
                  <span key={s.key} className="wk-tip-row">
                    <span className={`wk-line ${s.className}`} aria-hidden="true" />
                    <b>{formatNumber(w[s.key])}</b> {s.label.toLowerCase()}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <details className="wk-table">
        <summary>Ver como tabla</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Semana del</th>
              <th scope="col">Conversaciones</th>
              <th scope="col">Resueltas</th>
              <th scope="col">Derivadas</th>
            </tr>
          </thead>
          <tbody>
            {weekly.map((w) => (
              <tr key={w.weekStart}>
                <th scope="row">{formatWeek(w.weekStart)}</th>
                <td>{formatNumber(w.conversations)}</td>
                <td>{formatNumber(w.resolved)}</td>
                <td>{formatNumber(w.handedOff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
