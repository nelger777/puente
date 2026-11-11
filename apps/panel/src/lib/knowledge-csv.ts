import { KNOWLEDGE_MAX_ITEMS, KnowledgeItemInputSchema } from "@puente/shared";

export interface KnowledgeCsvRow {
  question: string;
  answer: string;
  category: string | null;
}

export const KNOWLEDGE_CSV_HEADER = ["Categoría", "Pregunta", "Respuesta"];

export function knowledgeCsvRows(items: KnowledgeCsvRow[]): string[][] {
  return [KNOWLEDGE_CSV_HEADER, ...items.map((i) => [i.category ?? "", i.question, i.answer])];
}

/** The separator Excel used: whichever of ; , or tab appears most in the first line. */
function detectSeparator(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t"].map((sep) => [sep, firstLine.split(sep).length] as const);
  return counts.reduce((best, c) => (c[1] > best[1] ? c : best))[0];
}

/** RFC 4180 parsing: quoted fields may hold separators, quotes ("") and line breaks. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const headerKey = (h: string) => h.trim().toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

const COLUMNS = {
  question: ["pregunta", "question"],
  answer: ["respuesta", "answer"],
  category: ["categoria", "category"],
} as const;

export interface KnowledgeCsvResult {
  items: KnowledgeCsvRow[];
  /** One message per rejected row (spreadsheet row numbers, header = 1). */
  errors: string[];
}

/** Reads a Categoría;Pregunta;Respuesta sheet (any column order; Categoría optional). */
export function parseKnowledgeCsv(text: string): KnowledgeCsvResult {
  const [header, ...rows] = parseCsv(text);
  const keys = (header ?? []).map(headerKey);
  const col = (names: readonly string[]) => keys.findIndex((k) => names.includes(k));
  const q = col(COLUMNS.question);
  const a = col(COLUMNS.answer);
  const c = col(COLUMNS.category);
  if (q < 0 || a < 0) {
    return {
      items: [],
      errors: [
        "La primera fila tiene que tener las columnas Pregunta y Respuesta (y opcional Categoría).",
      ],
    };
  }

  const items: KnowledgeCsvRow[] = [];
  const errors: string[] = [];
  rows.forEach((cells, index) => {
    if (cells.every((cell) => cell.trim() === "")) return;
    const parsed = KnowledgeItemInputSchema.safeParse({
      question: cells[q] ?? "",
      answer: cells[a] ?? "",
      category: c >= 0 ? cells[c] : null,
    });
    if (parsed.success) items.push(parsed.data);
    else {
      const field = parsed.error.issues[0]?.path[0];
      const what =
        field === "question" ? "la pregunta" : field === "answer" ? "la respuesta" : "la categoría";
      errors.push(`Fila ${index + 2}: revisa ${what} (vacía o demasiado larga).`);
    }
  });
  if (items.length > KNOWLEDGE_MAX_ITEMS) {
    errors.push(
      `El archivo tiene ${items.length} preguntas; la base admite hasta ${KNOWLEDGE_MAX_ITEMS}.`,
    );
  }
  return { items, errors };
}
