import type { HandoffReason, HandoffStatus } from "@puente/shared";
import type { ReactNode } from "react";
import { isSensitiveReason, reasonLabel } from "../lib/format";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ""}`}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function ReasonTag({ reason }: { reason: HandoffReason }) {
  return (
    <span className={`tag ${isSensitiveReason(reason) ? "tag-warn" : ""}`}>
      {reasonLabel(reason)}
    </span>
  );
}

export function StatusTag({ status }: { status: HandoffStatus }) {
  return status === "PENDING" ? (
    <span className="tag tag-pending">Pendiente</span>
  ) : (
    <span className="tag tag-done">Atendida</span>
  );
}

export function Loading() {
  return (
    <p className="muted" role="status">
      Cargando…
    </p>
  );
}

export function ErrorNote({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <span>{error.message}</span>
      {onRetry ? (
        <button type="button" className="btn ghost" onClick={onRetry}>
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
