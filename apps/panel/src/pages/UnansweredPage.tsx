import { KnowledgeItemInputSchema, type UnansweredQuestion } from "@puente/shared";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api/client";
import { Card, Empty, ErrorNote, Loading, PageHeader } from "../components/ui";
import { formatDate } from "../lib/format";
import { useApi } from "../lib/use-api";

const toError = (err: unknown) => (err instanceof Error ? err : new Error(String(err)));

function QuestionCard({
  item,
  onDone,
}: {
  item: UnansweredQuestion;
  onDone: (message: string) => void;
}) {
  const id = item.codes[0] ?? "";
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(item.question);
  const [answer, setAnswer] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(toError(err));
      setBusy(false);
    }
  }

  function add() {
    const parsed = KnowledgeItemInputSchema.safeParse({ question, answer });
    setInvalid(!parsed.success);
    if (!parsed.success) return;
    void run(async () => {
      await api.addUnanswered({ codes: item.codes, item: parsed.data });
      onDone("Pregunta agregada a la base. El asistente ya la usa desde el próximo mensaje.");
    });
  }

  function dismiss() {
    void run(async () => {
      await api.dismissUnanswered(item.codes);
      onDone("Pregunta descartada.");
    });
  }

  const cases = item.codes.length;
  return (
    <Card>
      <p className="unanswered-q">“{item.question}”</p>
      <p className="muted small">
        {cases === 1 ? "1 cliente" : `${cases} clientes`} · última vez {formatDate(item.lastAt)} ·{" "}
        {item.codes.slice(0, 3).map((code, i) => (
          <span key={code}>
            {i ? ", " : ""}
            <Link to={`/derivaciones/${code}`}>{code}</Link>
          </span>
        ))}
        {cases > 3 ? ` y ${cases - 3} más` : ""}
      </p>
      <p className="small">
        <span className="muted">Resumen para el equipo:</span> {item.summary}
      </p>

      {open ? (
        <div className="form">
          <div className="field">
            <label htmlFor={`uq-${id}`}>Pregunta para la base</label>
            <input
              id={`uq-${id}`}
              type="text"
              value={question}
              maxLength={300}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`ua-${id}`}>Respuesta</label>
            <textarea
              id={`ua-${id}`}
              rows={3}
              value={answer}
              maxLength={2000}
              aria-invalid={invalid}
              aria-describedby={invalid ? `ua-${id}-err` : undefined}
              onChange={(e) => setAnswer(e.target.value)}
            />
            {invalid ? (
              <div className="field-error" id={`ua-${id}-err`}>
                Pregunta y respuesta son obligatorias.
              </div>
            ) : null}
          </div>
          <p className="muted small">
            Escríbela en español: el asistente la traduce si el cliente habla otro idioma.
          </p>
          <div className="form-foot">
            <button type="button" className="btn" disabled={busy} onClick={add}>
              {busy ? "Guardando…" : "Guardar en la base"}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="form-foot">
          <button type="button" className="btn" disabled={busy} onClick={() => setOpen(true)}>
            Agregar a la base
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={dismiss}>
            Descartar
          </button>
        </div>
      )}
      {error ? <ErrorNote error={error} /> : null}
    </Card>
  );
}

export function UnansweredPage() {
  const list = useApi(() => api.unanswered(), []);
  const [notice, setNotice] = useState<string | null>(null);

  if (list.error) return <ErrorNote error={list.error} onRetry={list.reload} />;
  const items = list.data?.items;
  if (!items) return <Loading />;

  const done = (item: UnansweredQuestion) => (message: string) => {
    list.setData({ items: items.filter((i) => i !== item) });
    setNotice(message);
  };

  return (
    <>
      <PageHeader
        title="Sin respuesta"
        subtitle="Lo que los clientes preguntaron y el asistente no encontró en la base. Agrega la respuesta y la próxima vez contesta solo."
      />
      <div className="stack">
        {notice ? (
          <p className="success-note" role="status">
            {notice}
          </p>
        ) : null}
        {items.length === 0 ? (
          <Empty>No hay preguntas sin respuesta por revisar.</Empty>
        ) : (
          items.map((item) => <QuestionCard key={item.codes[0]} item={item} onDone={done(item)} />)
        )}
      </div>
    </>
  );
}
