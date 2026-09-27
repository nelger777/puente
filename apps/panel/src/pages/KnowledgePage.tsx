import {
  estimateTokens,
  KNOWLEDGE_TOKEN_WARNING,
  KnowledgePutSchema,
  type KnowledgeItemInput,
} from "@puente/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Card, Empty, ErrorNote, Loading, PageHeader } from "../components/ui";
import { formatNumber } from "../lib/format";
import { useApi } from "../lib/use-api";

interface Row extends KnowledgeItemInput {
  key: number;
}

let nextKey = 1;
const row = (item: KnowledgeItemInput): Row => ({ ...item, key: nextKey++ });

export function KnowledgePage() {
  const knowledge = useApi(() => api.knowledge(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (knowledge.data) setRows(knowledge.data.items.map(row));
  }, [knowledge.data]);

  if (knowledge.error) return <ErrorNote error={knowledge.error} onRetry={knowledge.reload} />;
  if (!rows) return <Loading />;

  const update = (next: Row[]) => {
    setRows(next);
    setDirty(true);
    setSaved(false);
  };
  const edit = (key: number, patch: Partial<KnowledgeItemInput>) =>
    update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target] as Row, next[index] as Row];
    update(next);
  };

  const chars = rows.reduce((n, r) => n + r.question.length + r.answer.length, 0);
  const tokens = estimateTokens(chars);
  const tooBig = tokens > KNOWLEDGE_TOKEN_WARNING;

  async function save() {
    if (!rows) return;
    const items = rows.map(({ question, answer }) => ({ question, answer }));
    const parsed = KnowledgePutSchema.safeParse({ items });
    if (!parsed.success) {
      const index = parsed.error.issues[0]?.path[1];
      setError(
        typeof index === "number"
          ? `Revisa la pregunta ${index + 1}: pregunta y respuesta son obligatorias.`
          : "Revisa las preguntas.",
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api.replaceKnowledge(parsed.data.items);
      setRows(result.items.map(row));
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Base de conocimiento"
        subtitle="El asistente responde solo con estas preguntas y respuestas."
        actions={
          <button
            type="button"
            className="btn ghost"
            onClick={() => update([...rows, row({ question: "", answer: "" })])}
          >
            Agregar pregunta
          </button>
        }
      />
      <p className={`meter ${tooBig ? "big" : ""}`} role="status">
        {rows.length} {rows.length === 1 ? "pregunta" : "preguntas"} · ~{formatNumber(tokens)}{" "}
        tokens por mensaje
        {tooBig ? " · La base es muy grande: cada mensaje será más caro y lento." : ""}
      </p>
      <div className="stack">
        {rows.length === 0 ? <Empty>Todavía no hay preguntas. Agrega la primera.</Empty> : null}
        {rows.map((r, i) => (
          <Card key={r.key}>
            <div className="kb-item">
              <span className="n" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <div className="field">
                  <label htmlFor={`q-${r.key}`}>Pregunta {i + 1}</label>
                  <input
                    id={`q-${r.key}`}
                    type="text"
                    value={r.question}
                    maxLength={300}
                    onChange={(e) => edit(r.key, { question: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`a-${r.key}`}>Respuesta {i + 1}</label>
                  <textarea
                    id={`a-${r.key}`}
                    rows={3}
                    value={r.answer}
                    maxLength={2000}
                    onChange={(e) => edit(r.key, { answer: e.target.value })}
                  />
                </div>
              </div>
              <div className="kb-tools">
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label={`Subir pregunta ${i + 1}`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label={`Bajar pregunta ${i + 1}`}
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label={`Eliminar pregunta ${i + 1}`}
                  onClick={() => update(rows.filter((x) => x.key !== r.key))}
                >
                  ✕
                </button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <div className="form-foot">
        <button
          type="button"
          className="btn"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? "Guardando…" : "Guardar base"}
        </button>
        {saved ? (
          <span className="success-note" role="status">
            Base guardada
          </span>
        ) : null}
        {dirty ? <span className="muted small">Hay cambios sin guardar.</span> : null}
        {error ? (
          <span className="field-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </>
  );
}
