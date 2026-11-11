import {
  estimateTokens,
  KNOWLEDGE_CATEGORY_MAX,
  KNOWLEDGE_MAX_ITEMS,
  KNOWLEDGE_TOKEN_WARNING,
  KnowledgePutSchema,
  type KnowledgeResponse,
} from "@puente/shared";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api } from "../api/client";
import { Card, Empty, ErrorNote, Loading, PageHeader } from "../components/ui";
import { downloadCsv } from "../lib/csv";
import { formatDate, formatNumber } from "../lib/format";
import {
  knowledgeCsvRows,
  parseKnowledgeCsv,
  type KnowledgeCsvResult,
  type KnowledgeCsvRow,
} from "../lib/knowledge-csv";
import { useApi } from "../lib/use-api";

interface Row extends KnowledgeCsvRow {
  key: number;
}

let nextKey = 1;
const row = (item: KnowledgeCsvRow): Row => ({ ...item, key: nextKey++ });
const fromServer = (data: KnowledgeResponse) =>
  data.items.map((i) => row({ question: i.question, answer: i.answer, category: i.category }));

const ALL = "";
const NONE = "__sin_categoria__";

/** Plain-text match, ignoring case and accents. */
const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

export function KnowledgePage() {
  const knowledge = useApi(() => api.knowledge(), []);
  const versions = useApi(() => api.knowledgeVersions(), []);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [imported, setImported] = useState<(KnowledgeCsvResult & { file: string }) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (knowledge.data) setRows(fromServer(knowledge.data));
  }, [knowledge.data]);

  if (knowledge.error) return <ErrorNote error={knowledge.error} onRetry={knowledge.reload} />;
  if (!rows) return <Loading />;

  const update = (next: Row[]) => {
    setRows(next);
    setDirty(true);
    setSaved(null);
  };
  const edit = (key: number, patch: Partial<KnowledgeCsvRow>) =>
    update(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target] as Row, next[index] as Row];
    update(next);
  };

  const categories = [
    ...new Set(rows.map((r) => r.category?.trim()).filter((c): c is string => !!c)),
  ].sort((a, b) => a.localeCompare(b));
  const needle = fold(search.trim());
  const filtering = needle !== "" || category !== ALL;
  const visible = rows
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => {
      if (category === NONE && r.category?.trim()) return false;
      if (category !== ALL && category !== NONE && r.category?.trim() !== category) return false;
      return !needle || fold(`${r.question} ${r.answer}`).includes(needle);
    });

  const chars = rows.reduce((n, r) => n + r.question.length + r.answer.length, 0);
  const tokens = estimateTokens(chars);
  const tooBig = tokens > KNOWLEDGE_TOKEN_WARNING;

  async function save() {
    if (!rows) return;
    const items = rows.map(({ question, answer, category: c }) => ({
      question,
      answer,
      category: c,
    }));
    const parsed = KnowledgePutSchema.safeParse({ items });
    if (!parsed.success) {
      const index = parsed.error.issues[0]?.path[1];
      setError(
        typeof index === "number"
          ? `Revisa la pregunta ${index + 1}: pregunta y respuesta son obligatorias; la categoría, de hasta ${KNOWLEDGE_CATEGORY_MAX} caracteres.`
          : `Revisa las preguntas (máximo ${KNOWLEDGE_MAX_ITEMS}).`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await api.replaceKnowledge(parsed.data.items);
      setRows(fromServer(result));
      setDirty(false);
      setSaved("Base guardada");
      versions.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    downloadCsv("base-de-conocimiento.csv", knowledgeCsvRows(rows ?? []));
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImported({ ...parseKnowledgeCsv(await file.text()), file: file.name });
  }

  function applyImport(mode: "append" | "replace") {
    if (!imported || !rows) return;
    const incoming = imported.items.map(row);
    update(mode === "append" ? [...rows, ...incoming] : incoming);
    setSearch("");
    setCategory(ALL);
    setImported(null);
  }

  async function restore(id: string, when: string) {
    const warning = dirty ? " Los cambios sin guardar se pierden." : "";
    if (!window.confirm(`¿Volver a la base como estaba antes del ${when}?${warning}`)) return;
    setSaving(true);
    setError(null);
    try {
      setRows(fromServer(await api.restoreKnowledgeVersion(id)));
      setDirty(false);
      setSaved("Versión restaurada. La base que había quedó guardada como versión anterior.");
      versions.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const importFits = !imported || rows.length + imported.items.length <= KNOWLEDGE_MAX_ITEMS;

  return (
    <>
      <PageHeader
        title="Base de conocimiento"
        subtitle="El asistente responde solo con estas preguntas y respuestas."
        actions={
          <>
            <button type="button" className="btn ghost small" onClick={exportCsv}>
              Exportar CSV
            </button>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => fileInput.current?.click()}
            >
              Importar CSV
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => void pickFile(e)}
            />
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setSearch("");
                setCategory(ALL);
                update([...rows, row({ question: "", answer: "", category: null })]);
              }}
            >
              Agregar pregunta
            </button>
          </>
        }
      />

      {imported ? (
        <Card title={`Importar ${imported.file}`}>
          {imported.items.length ? (
            <p>
              Se leyeron <b>{imported.items.length}</b>{" "}
              {imported.items.length === 1 ? "pregunta" : "preguntas"}. La base tiene {rows.length}.
              Nada se guarda hasta que toques “Guardar base”.
            </p>
          ) : null}
          {imported.errors.length ? (
            <ul className="import-errors">
              {imported.errors.slice(0, 8).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {imported.errors.length > 8 ? (
                <li>y {imported.errors.length - 8} filas más con problemas.</li>
              ) : null}
            </ul>
          ) : null}
          <div className="form-foot">
            {imported.items.length ? (
              <>
                <button
                  type="button"
                  className="btn"
                  disabled={!importFits}
                  title={importFits ? undefined : `Superaría ${KNOWLEDGE_MAX_ITEMS} preguntas`}
                  onClick={() => applyImport("append")}
                >
                  Agregar al final
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={imported.items.length > KNOWLEDGE_MAX_ITEMS}
                  onClick={() => applyImport("replace")}
                >
                  Reemplazar toda la base
                </button>
              </>
            ) : null}
            <button type="button" className="btn ghost" onClick={() => setImported(null)}>
              Cancelar
            </button>
          </div>
          <p className="muted small">
            Columnas: Pregunta y Respuesta (obligatorias) y Categoría (opcional), en la primera
            fila. Sirve el mismo formato que “Exportar CSV”.
          </p>
        </Card>
      ) : null}

      <div className="kb-filters">
        <div className="field">
          <label htmlFor="kb-search">Buscar</label>
          <input
            id="kb-search"
            type="text"
            placeholder="Texto de la pregunta o la respuesta"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="kb-category">Categoría</label>
          <select id="kb-category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value={ALL}>Todas</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={NONE}>Sin categoría</option>
          </select>
        </div>
      </div>
      <p className={`meter ${tooBig ? "big" : ""}`} role="status">
        {filtering ? `Mostrando ${visible.length} de ` : ""}
        {rows.length} {rows.length === 1 ? "pregunta" : "preguntas"} · ~{formatNumber(tokens)}{" "}
        tokens por mensaje
        {tooBig ? " · La base es muy grande: cada mensaje será más caro y lento." : ""}
        {filtering ? " · Para reordenar, quita el filtro." : ""}
      </p>

      <datalist id="kb-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="stack">
        {rows.length === 0 ? <Empty>Todavía no hay preguntas. Agrega la primera.</Empty> : null}
        {rows.length > 0 && visible.length === 0 ? (
          <Empty>Ninguna pregunta coincide con el filtro.</Empty>
        ) : null}
        {visible.map(({ r, index: i }) => (
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
                <div className="field kb-category">
                  <label htmlFor={`c-${r.key}`}>Categoría (opcional)</label>
                  <input
                    id={`c-${r.key}`}
                    type="text"
                    list="kb-categories"
                    value={r.category ?? ""}
                    maxLength={KNOWLEDGE_CATEGORY_MAX}
                    placeholder="Ej.: Autos, Siniestros, Pagos"
                    onChange={(e) => edit(r.key, { category: e.target.value || null })}
                  />
                </div>
              </div>
              <div className="kb-tools">
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label={`Subir pregunta ${i + 1}`}
                  disabled={filtering || i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label={`Bajar pregunta ${i + 1}`}
                  disabled={filtering || i === rows.length - 1}
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
            {saved}
          </span>
        ) : null}
        {dirty ? <span className="muted small">Hay cambios sin guardar.</span> : null}
        {error ? (
          <span className="field-error" role="alert">
            {error}
          </span>
        ) : null}
      </div>

      <Card title="Versiones anteriores" className="usage">
        <p className="muted small">
          Cada vez que se guarda la base, la que había queda acá (las últimas 10). Restaurar una
          también se puede deshacer.
        </p>
        {versions.error ? <ErrorNote error={versions.error} onRetry={versions.reload} /> : null}
        {versions.data && versions.data.versions.length === 0 ? (
          <p className="muted">Todavía no hay versiones anteriores.</p>
        ) : null}
        <ul className="plain-list">
          {versions.data?.versions.map((v) => {
            const when = formatDate(v.createdAt);
            return (
              <li key={v.id} className="version-row">
                <span>
                  <b>Antes del {when}</b>
                  <span className="muted small">
                    {" "}
                    · {v.itemCount} {v.itemCount === 1 ? "pregunta" : "preguntas"}
                    {v.replacedBy ? ` · cambio de ${v.replacedBy}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn ghost small"
                  disabled={saving}
                  onClick={() => void restore(v.id, when)}
                >
                  Restaurar
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
